import { env } from "cloudflare:workers";
import {
  type CoreContext,
  checkOrderSlots,
  checkSlots,
  createManualPromotion,
  createOrder,
  endPromotion,
  extendPromotion,
  markOrderPaid,
  refundOrder,
  rejectOrder,
  runPromotionMaintenance,
  setPlacementSlots,
  startPaidOrder,
  upsertProduct,
} from "@tgbox/core";
import {
  createUsdtPayment,
  getOrder,
  getSiteState,
  insertApprovedEntry,
  listActivePromotions,
  listProducts,
  listPromotionsOfOrders,
  markOrdersReminded,
  setEntryStatus,
  setUserLocale,
} from "@tgbox/db";
import { describe, expect, onTestFinished, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const DAY = 24 * 60 * 60 * 1000;
const BUYER = 5150;
const PIN_7 = 1;
const BANNER_7 = 3;
const banner = { title: "新频道", subtitle: "每天更新", href: "https://t.me/new_channel" };

async function listed(username: string, categoryId = 1) {
  const { id } = await insertApprovedEntry(db, {
    entry: { username, kind: "channel", categoryId, title: username, listedAt: NOW - 1 },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW - 1 },
    tagIds: [],
    now: NOW - 1,
  });
  return id;
}

async function order(
  ctx: CoreContext,
  productId: number,
  content: { targetUsername?: string; banner?: unknown },
) {
  const result = await createOrder(ctx, { tgUserId: BUYER, productId, ...content });
  if (!result.ok) throw new Error(result.error);
  return result.order;
}

const starsPayment = (orderId: number, chargeId = `charge-${orderId}`) => ({
  orderId,
  provider: "stars" as const,
  chargeId,
  amount: "500",
  currency: "XTR" as const,
});

describe("creating orders", () => {
  test.each([
    [{ productId: PIN_7, targetUsername: "@not_listed" }, "target_not_listed"],
    [{ productId: PIN_7, targetUsername: "https://t.me/+invite" }, "invalid_target"],
    [{ productId: PIN_7, targetUsername: "@hidden_pin" }, "target_not_listed"],
    [{ productId: BANNER_7, banner: { ...banner, href: "http://example.com" } }, "invalid_banner"],
    [{ productId: BANNER_7, banner: { ...banner, title: "x".repeat(21) } }, "invalid_banner"],
    [{ productId: 999 }, "product_unavailable"],
  ])("%j is refused with %s", async (input, error) => {
    const { ctx } = await setup();
    const hidden = await listed("hidden_pin");
    await setEntryStatus(db, hidden, "hidden_by_admin", NOW);
    expect(await createOrder(ctx, { tgUserId: BUYER, ...input })).toMatchObject({
      ok: false,
      error,
    });
  });

  test("a pin for an approved entry and a valid banner create pending orders", async () => {
    const { ctx } = await setup();
    await listed("pin_me");
    const pin = await createOrder(ctx, {
      tgUserId: BUYER,
      productId: PIN_7,
      targetUsername: "t.me/Pin_Me",
    });
    expect(pin).toMatchObject({
      ok: true,
      order: { status: "pending", kind: "pin", days: 7, targetUsername: "pin_me" },
    });
    const card = await createOrder(ctx, { tgUserId: BUYER, productId: BANNER_7, banner });
    expect(card).toMatchObject({ ok: true, order: { kind: "banner", banner } });
  });

  test("ordering the same pin again reuses the unpaid order, unless its USDT quote ran out", async () => {
    const { ctx } = await setup();
    await listed("pin_me");
    const first = await order(ctx, PIN_7, { targetUsername: "@pin_me" });
    expect((await order(ctx, PIN_7, { targetUsername: "t.me/pin_me" })).id).toBe(first.id);
    expect(
      await createOrder(ctx, { tgUserId: BUYER + 1, productId: PIN_7, targetUsername: "pin_me" }),
    ).toMatchObject({ ok: true });
    expect((await auditRows()).filter((row) => row.action === "order.create")).toHaveLength(2);

    await createUsdtPayment(db, {
      orderId: first.id,
      amountMicro: 10_000_100,
      address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      createdAt: NOW,
      expiresAt: NOW + 30 * 60_000,
    });
    expect((await order(ctx, PIN_7, { targetUsername: "pin_me" })).id).toBe(first.id);
    const later = { ...ctx, now: () => NOW + 31 * 60_000 };
    expect((await order(later, PIN_7, { targetUsername: "pin_me" })).id).not.toBe(first.id);
  });

  test("a buyer can't hold more than five unpaid orders", async () => {
    const { ctx } = await setup();
    for (let i = 0; i < 5; i++) await order(ctx, BANNER_7, { banner });
    expect(await createOrder(ctx, { tgUserId: BUYER, productId: BANNER_7, banner })).toEqual({
      ok: false,
      error: "too_many_pending",
    });
    // Another buyer is unaffected.
    expect(
      await createOrder(ctx, { tgUserId: BUYER + 1, productId: BANNER_7, banner }),
    ).toMatchObject({ ok: true });
  });
});

/** Runs `body` while every promotion insert fails, like a D1 error halfway through activation. */
async function withFailingPromotionInsert(body: () => Promise<void>) {
  await env.DB.prepare(
    "CREATE TRIGGER fail_promotion BEFORE INSERT ON promotions BEGIN SELECT RAISE(ABORT, 'injected'); END",
  ).run();
  try {
    await body();
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_promotion").run();
  }
}

describe("paying", () => {
  test("a pin whose promotion failed to start is never active, and the retry starts it", async () => {
    const { ctx } = await setup();
    await listed("pin_me");
    const pin = await order(ctx, PIN_7, { targetUsername: "@pin_me" });

    await withFailingPromotionInsert(async () => {
      await expect(markOrderPaid(ctx, starsPayment(pin.id))).rejects.toThrow();
    });
    // The payment is on record, but the order didn't go live without its promotion.
    expect(await getOrder(db, pin.id)).toMatchObject({ status: "paid" });
    expect(await listActivePromotions(db, NOW)).toEqual([]);

    // Another charge for the same order is not this payment and finishes nothing.
    expect(await markOrderPaid(ctx, starsPayment(pin.id, "other"))).toMatchObject({
      changed: false,
      order: { status: "paid" },
    });

    // The provider redelivers the same charge: the retry completes the activation.
    expect(await markOrderPaid(ctx, starsPayment(pin.id))).toMatchObject({
      changed: true,
      order: { status: "active" },
    });
    expect(await listActivePromotions(db, NOW)).toMatchObject([{ orderId: pin.id }]);
    expect(await markOrderPaid(ctx, starsPayment(pin.id))).toMatchObject({ changed: false });
    expect(await listActivePromotions(db, NOW)).toHaveLength(1);
  });

  test("a paid pin goes live at once; the retried callback changes nothing", async () => {
    const { ctx, dispatches } = await setup();
    await listed("pin_me");
    const created = await createOrder(ctx, {
      tgUserId: BUYER,
      productId: PIN_7,
      targetUsername: "@pin_me",
    });
    if (!created.ok) throw new Error(created.error);

    const first = await markOrderPaid(ctx, starsPayment(created.order.id));
    expect(first).toMatchObject({
      changed: true,
      order: {
        status: "active",
        startsAt: NOW,
        endsAt: NOW + 7 * DAY,
        chargeId: `charge-${created.order.id}`,
      },
    });
    const again = await markOrderPaid(ctx, starsPayment(created.order.id));
    expect(again?.changed).toBe(false);

    expect(await listActivePromotions(db, NOW)).toMatchObject([
      { kind: "pin", entryUsername: "pin_me", orderId: created.order.id, endsAt: NOW + 7 * DAY },
    ]);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches).toHaveLength(1);
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "order.create",
      "order.paid",
      "promotion.start",
    ]);
    expect(await markOrderPaid(ctx, starsPayment(9999))).toBeNull();
  });

  test("a paid banner waits for review, holds a slot, and goes live on approval", async () => {
    const { ctx } = await setup();
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, starsPayment(created.id));

    expect(await getOrder(db, created.id)).toMatchObject({ status: "paid" });
    expect(await listActivePromotions(db, NOW)).toEqual([]);
    expect(await checkSlots(ctx, "banner")).toEqual({ available: 4, nextFreeAt: null });

    expect(await startPaidOrder(ctx, { orderId: created.id, actor })).toMatchObject({
      ok: true,
      order: { status: "active", endsAt: NOW + 7 * DAY },
    });
    expect(await startPaidOrder(ctx, { orderId: created.id, actor })).toEqual({
      ok: false,
      error: "not_paid",
    });
    expect(await listActivePromotions(db, NOW, "banner")).toMatchObject([{ banner }]);
    expect(await checkSlots(ctx, "banner")).toEqual({ available: 4, nextFreeAt: NOW + 7 * DAY });
  });

  test("two buyers paying for the last slot: the later one waits, paid, until an admin starts it", async () => {
    const { ctx } = await setup();
    const slots = (await listProducts(db)).find((p) => p.kind === "pin")?.slots ?? 10;
    onTestFinished(() => setPlacementSlots(ctx, { kind: "pin", slots, actor }).then(() => {}));
    await setPlacementSlots(ctx, { kind: "pin", slots: 1, actor });
    await listed("first_pin");
    await listed("second_pin");
    // Both were quoted while the slot was free.
    const first = await order(ctx, PIN_7, { targetUsername: "first_pin" });
    const second = await order(ctx, PIN_7, { targetUsername: "second_pin" });

    expect(await markOrderPaid(ctx, starsPayment(first.id))).toMatchObject({
      changed: true,
      waiting: false,
      order: { status: "active" },
    });
    expect(await markOrderPaid(ctx, starsPayment(second.id))).toMatchObject({
      changed: true,
      waiting: true,
      order: { status: "paid" },
    });
    expect(await listActivePromotions(db, NOW)).toMatchObject([{ entryUsername: "first_pin" }]);
    // A redelivered callback neither starts it nor reports it again.
    expect(await markOrderPaid(ctx, starsPayment(second.id))).toMatchObject({
      changed: false,
      waiting: true,
    });

    expect(await startPaidOrder(ctx, { orderId: second.id, actor })).toEqual({
      ok: false,
      error: "no_slots",
    });
    const [live] = await listActivePromotions(db, NOW);
    await endPromotion(ctx, { promotionId: live?.id ?? 0, actor });
    expect(await startPaidOrder(ctx, { orderId: second.id, actor })).toMatchObject({
      ok: true,
      order: { status: "active", endsAt: NOW + 7 * DAY },
    });
    expect(await listActivePromotions(db, NOW)).toMatchObject([{ entryUsername: "second_pin" }]);
  });

  test("a full category doesn't hold back a category pin paid in another one", async () => {
    const { ctx } = await setup();
    const product = await weekOf("category_pin");
    for (const name of ["news_a", "news_b", "news_c", "news_d"]) await listed(name, 1);
    await listed("games_a", 2);
    const pending = [];
    for (const name of ["news_a", "news_b", "news_c", "news_d", "games_a"]) {
      pending.push(await order(ctx, product, { targetUsername: name }));
    }
    const paid = [];
    for (const created of pending) paid.push(await markOrderPaid(ctx, starsPayment(created.id)));
    expect(paid.map((result) => result?.waiting)).toEqual([false, false, false, true, false]);
    expect((await listActivePromotions(db, NOW)).map((row) => row.entryUsername)).toEqual([
      "news_a",
      "news_b",
      "news_c",
      "games_a",
    ]);
  });

  test("rejecting a Stars banner refunds it through the Bot API", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "123:bot" });
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, starsPayment(created.id, "tg-charge"));

    const result = await rejectOrder(ctx, { orderId: created.id, actor, reason: "spam" });
    expect(result).toMatchObject({ refunded: true, order: { status: "refunded", note: "spam" } });
    expect(telegram).toEqual([
      {
        method: "refundStarPayment",
        body: { user_id: BUYER, telegram_payment_charge_id: "tg-charge" },
      },
      {
        method: "sendMessage",
        body: {
          chat_id: BUYER,
          text: "很抱歉，你的广告未通过审核，Stars 已原路退回。\n\nSorry, your ad was not approved. Your Stars were refunded.",
        },
      },
    ]);
    expect(await rejectOrder(ctx, { orderId: created.id, actor })).toBeNull();
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "order.create",
      "order.paid",
      "order.reject",
      "order.refund",
    ]);
  });

  test("a Stars refund that failed can be retried, and only once it succeeds is it refunded", async () => {
    const { ctx } = await setup({ BOT_TOKEN: "123:bot" });
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, starsPayment(created.id, "tg-charge"));
    const down = {
      ...ctx,
      fetch: async () => Response.json({ ok: false, description: "Internal Server Error" }),
    };

    expect(await rejectOrder(down, { orderId: created.id, actor })).toMatchObject({
      refunded: false,
      order: { status: "rejected" },
    });
    expect(await refundOrder(down, { orderId: created.id, actor })).toMatchObject({
      refunded: false,
      order: { status: "rejected" },
    });

    expect(await refundOrder(ctx, { orderId: created.id, actor })).toMatchObject({
      refunded: true,
      order: { status: "refunded" },
    });
    expect(await refundOrder(ctx, { orderId: created.id, actor })).toBeNull();
    expect((await auditRows()).filter((row) => row.action === "order.refund")).toHaveLength(1);
  });

  test("a USDT refund done by hand is recorded by an admin; it can't be sent as Stars", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "123:bot" });
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, {
      orderId: created.id,
      provider: "usdt",
      chargeId: "tx",
      amount: "20.0001",
      currency: "USDT",
    });
    await rejectOrder(ctx, { orderId: created.id, actor });
    expect(await refundOrder(ctx, { orderId: created.id, actor })).toBeNull();
    expect(await refundOrder(ctx, { orderId: created.id, actor, manual: true })).toMatchObject({
      refunded: true,
      order: { status: "refunded" },
    });
    // Told to contact support when rejected, then that the refund is done; nothing goes to Stars.
    expect(telegram.map((call) => call.method)).toEqual(["sendMessage", "sendMessage"]);
    expect(JSON.stringify(telegram[0]?.body)).toContain(`办理退款（订单 #${created.id}）`);
    expect(JSON.stringify(telegram[1]?.body)).toContain(`订单 #${created.id} 的款项已退回给你`);
  });

  test("rejecting a USDT banner leaves the refund to an admin", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "123:bot" });
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, {
      orderId: created.id,
      provider: "cryptopay",
      chargeId: "777",
      amount: "20",
      currency: "USDT",
    });

    expect(await rejectOrder(ctx, { orderId: created.id, actor })).toMatchObject({
      refunded: false,
      order: { status: "rejected" },
    });
    expect(telegram.map((call) => call.method)).toEqual(["sendMessage"]);
  });

  test("a buyer who chose a bot language is told in it alone", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "123:bot" });
    await setUserLocale(db, BUYER, "zh-hant", NOW);
    const created = await order(ctx, BANNER_7, { banner });
    await markOrderPaid(ctx, starsPayment(created.id));
    await startPaidOrder(ctx, { orderId: created.id, actor });
    expect(telegram.map((call) => (call.body as { text: string }).text)).toEqual([
      `🎉 你的廣告（首頁橫幅「新频道」）已通過審核並上線，展示至 ${new Date(NOW + 7 * DAY).toISOString().slice(0, 16).replace("T", " ")} UTC。`,
    ]);
  });
});

/** The 7-day product of a kind, looked up rather than hard-coding migration ids. */
async function weekOf(kind: string) {
  const product = (await listProducts(db)).find((p) => p.kind === kind && p.days === 7);
  if (!product) throw new Error(`no 7-day ${kind} product`);
  return product.id;
}

describe("promotion tiers", () => {
  test("a paid highlight goes live at once, like any entry promotion", async () => {
    const { ctx } = await setup();
    await listed("shiny");
    const created = await order(ctx, await weekOf("highlight"), { targetUsername: "@shiny" });
    await markOrderPaid(ctx, starsPayment(created.id));
    expect(await listActivePromotions(db, NOW)).toMatchObject([
      { kind: "highlight", entryUsername: "shiny" },
    ]);
  });

  test("category pins have three slots per category", async () => {
    const { ctx } = await setup();
    for (const name of ["news_a", "news_b", "news_c", "news_d"]) await listed(name, 1);
    await listed("games_a", 2);
    const product = await weekOf("category_pin");
    for (const name of ["news_a", "news_b", "news_c"]) {
      const created = await order(ctx, product, { targetUsername: name });
      await markOrderPaid(ctx, starsPayment(created.id));
    }
    expect(
      await createOrder(ctx, { tgUserId: BUYER, productId: product, targetUsername: "news_d" }),
    ).toEqual({
      ok: false,
      error: "no_slots",
      nextFreeAt: NOW + 7 * DAY,
    });
    // Another category is untouched by the first one filling up.
    const games = await order(ctx, product, { targetUsername: "games_a" });
    expect(await checkOrderSlots(ctx, games)).toEqual({ available: 3, nextFreeAt: null });
    expect(await checkSlots(ctx, "category_pin", 1)).toMatchObject({ available: 0 });
  });

  test("the announcement bar is a reviewed ad without an image", async () => {
    const { ctx } = await setup();
    const created = await order(ctx, await weekOf("announcement"), {
      banner: { ...banner, imageUrl: "https://media.example.org/promos/1.jpg" },
    });
    expect(created.banner).toEqual(banner);
    await markOrderPaid(ctx, starsPayment(created.id));
    expect(await listActivePromotions(db, NOW)).toEqual([]);
    expect(await checkSlots(ctx, "announcement")).toEqual({ available: 0, nextFreeAt: null });
    await startPaidOrder(ctx, { orderId: created.id, actor });
    expect(await listActivePromotions(db, NOW)).toMatchObject([{ kind: "announcement", banner }]);
  });
});

describe("slots and products", () => {
  test("a full kind reports when the next slot frees up", async () => {
    const { ctx } = await setup();
    for (const days of [5, 3, 4, 6, 7]) {
      await createManualPromotion(ctx, { kind: "banner", days, banner, actor });
    }
    expect(await checkSlots(ctx, "banner")).toEqual({ available: 0, nextFreeAt: NOW + 3 * DAY });
    expect(await createOrder(ctx, { tgUserId: BUYER, productId: BANNER_7, banner })).toEqual({
      ok: false,
      error: "no_slots",
      nextFreeAt: NOW + 3 * DAY,
    });
    expect(await checkSlots(ctx, "pin")).toEqual({ available: 10, nextFreeAt: null });
    expect(
      await createManualPromotion(ctx, { kind: "pin", days: 3, targetUsername: "@nobody", actor }),
    ).toEqual({ ok: false, error: "target_not_listed" });
  });

  test("a placement's size is one admin setting shared by its durations", async () => {
    const { ctx, dispatches } = await setup();
    expect(await setPlacementSlots(ctx, { kind: "banner", slots: 8, actor })).toBe(true);
    const banners = (await listProducts(db)).filter((p) => p.kind === "banner");
    expect(banners.map((p) => p.slots)).toEqual([8, 8]);
    expect(await checkSlots(ctx, "banner")).toEqual({ available: 8, nextFreeAt: null });
    // The site shows free slots, so it is rebuilt.
    expect(dispatches).toHaveLength(1);
    for (const slots of [0, 101, 2.5]) {
      expect(await setPlacementSlots(ctx, { kind: "banner", slots, actor })).toBe(false);
    }
    // A new duration joins at the placement's size.
    const created = await upsertProduct(ctx, {
      kind: "banner",
      nameZh: "首页横幅 90 天",
      nameEn: "Home banner for 90 days",
      days: 90,
      priceStars: 12000,
      priceUsdt: "150",
      active: true,
      sort: 45,
      actor,
    });
    if (!created.ok) throw new Error(created.error);
    expect((await listProducts(db)).find((p) => p.id === created.id)?.slots).toBe(8);
  });

  test("products are validated on create and edit", async () => {
    const { ctx } = await setup();
    const product = {
      kind: "pin" as const,
      nameZh: " 置顶 1 天 ",
      nameEn: "Pin for 1 day",
      days: 1,
      priceStars: 100,
      priceUsdt: "2.5",
      active: false,
      sort: 5,
      actor,
    };
    const created = await upsertProduct(ctx, product);
    if (!created.ok) throw new Error(created.error);
    expect(await upsertProduct(ctx, { ...product, id: created.id, priceUsdt: "1.234" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await upsertProduct(ctx, { ...product, id: 9999 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await createOrder(ctx, { tgUserId: BUYER, productId: created.id })).toEqual({
      ok: false,
      error: "product_unavailable",
    });
    expect(await auditRows()).toEqual([
      {
        actor: "email:admin@example.com",
        action: "product.upsert",
        target: `product:${created.id}`,
      },
    ]);
  });
});

describe("running promotions", () => {
  test("extend moves the order end and re-arms the reminder; end expires the order", async () => {
    const { ctx } = await setup();
    await listed("pin_me");
    const created = await order(ctx, PIN_7, { targetUsername: "pin_me" });
    await markOrderPaid(ctx, starsPayment(created.id));
    const [promotion] = await listActivePromotions(db, NOW);
    if (!promotion) throw new Error("no promotion");

    expect(await extendPromotion(ctx, { promotionId: promotion.id, days: 3, actor })).toMatchObject(
      { endsAt: NOW + 10 * DAY },
    );
    expect(await getOrder(db, created.id)).toMatchObject({ endsAt: NOW + 10 * DAY });
    expect(await extendPromotion(ctx, { promotionId: promotion.id, days: 0, actor })).toBeNull();

    expect(await endPromotion(ctx, { promotionId: promotion.id, actor })).toBe(true);
    expect(await endPromotion(ctx, { promotionId: promotion.id, actor })).toBe(false);
    expect(await getOrder(db, created.id)).toMatchObject({ status: "expired" });
    expect(await listActivePromotions(db, NOW)).toEqual([]);
  });

  test("maintenance ends and reminds no more than one hour's notices, ended ones first", async () => {
    const { ctx } = await setup();
    await listed("pin_me");
    const paid = [];
    for (let i = 0; i < 4; i++) {
      const created = await order(ctx, PIN_7, { targetUsername: "pin_me" });
      await markOrderPaid({ ...ctx, now: () => NOW + i * DAY }, starsPayment(created.id));
      paid.push(created.id);
    }
    // At NOW + 8.5 days the first two have ended and the other two end within a day.
    const run = await runPromotionMaintenance(ctx, NOW + 8.5 * DAY, { maxNotices: 3 });
    expect(run.expired.map((row) => row.id)).toEqual(paid.slice(0, 2));
    expect(run.expiringSoon.map((row) => row.id)).toEqual([paid[2]]);

    const capped = await runPromotionMaintenance(ctx, NOW + 9.6 * DAY, { maxNotices: 1 });
    expect(capped.expired.map((row) => row.id)).toEqual([paid[2]]);
    expect(capped.expiringSoon).toEqual([]);
    // The one left over ends on the next run instead of being skipped.
    const next = await runPromotionMaintenance(ctx, NOW + 11 * DAY, { maxNotices: 1 });
    expect(next.expired.map((row) => row.id)).toEqual([paid[3]]);
  });

  test("maintenance expires, reminds once, and deletes stale unpaid orders", async () => {
    const { ctx, dispatches } = await setup();
    await listed("pin_me");
    const created = await order(ctx, PIN_7, { targetUsername: "pin_me" });
    await markOrderPaid(ctx, starsPayment(created.id));
    const stale = await order(ctx, BANNER_7, { banner });
    // As if the site was rebuilt since the pin went live.
    await env.DB.prepare("DELETE FROM site_state").run();

    const quiet = await runPromotionMaintenance(ctx, NOW + DAY);
    expect(quiet).toEqual({ expired: [], expiringSoon: [], deletedPending: 0 });

    const soon = await runPromotionMaintenance(ctx, NOW + 6.5 * DAY);
    expect(soon.expiringSoon.map((row) => [row.id, row.tgUserId])).toEqual([[created.id, BUYER]]);
    expect(soon.deletedPending).toBe(1);
    expect(await getOrder(db, stale.id)).toBeUndefined();
    // Not delivered yet: offered again until the caller marks it sent.
    expect((await runPromotionMaintenance(ctx, NOW + 6.55 * DAY)).expiringSoon).toHaveLength(1);
    expect(await markOrdersReminded(db, [created.id], NOW + 6.55 * DAY)).toBe(1);
    expect((await runPromotionMaintenance(ctx, NOW + 6.6 * DAY)).expiringSoon).toEqual([]);

    const dispatchesBefore = dispatches.length;
    const done = await runPromotionMaintenance(ctx, NOW + 7 * DAY);
    expect(done.expired).toMatchObject([{ id: created.id, status: "expired", tgUserId: BUYER }]);
    expect(await listActivePromotions(db, NOW + 7 * DAY)).toEqual([]);
    // The ended promotion keeps its row, so the order's clicks stay attached to it.
    expect(await listPromotionsOfOrders(db, [created.id])).toMatchObject([
      { endedAt: NOW + 7 * DAY },
    ]);
    expect(await getSiteState(db, "dirty_since")).toBeDefined();
    expect(dispatches.length).toBe(dispatchesBefore + 1);
    expect((await auditRows()).filter((row) => row.actor === "system")).toEqual([
      { actor: "system", action: "order.cleanup", target: "orders" },
      { actor: "system", action: "promotion.expire", target: "promotions" },
    ]);
  });
});
