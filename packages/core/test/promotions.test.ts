import { env } from "cloudflare:workers";
import {
  approveBannerOrder,
  type CoreContext,
  checkSlots,
  createManualPromotion,
  createOrder,
  endPromotion,
  extendPromotion,
  markOrderPaid,
  rejectOrder,
  runPromotionMaintenance,
  upsertProduct,
} from "@tgbox/core";
import {
  getOrder,
  getSiteState,
  insertApprovedEntry,
  listActivePromotions,
  setEntryStatus,
} from "@tgbox/db";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const DAY = 24 * 60 * 60 * 1000;
const BUYER = 5150;
const PIN_7 = 1;
const BANNER_7 = 3;
const banner = { title: "新频道", subtitle: "每天更新", href: "https://t.me/new_channel" };

async function listed(username: string) {
  const { id } = await insertApprovedEntry(db, {
    entry: { username, kind: "channel", categoryId: 1, title: username, listedAt: NOW - 1 },
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
});

describe("paying", () => {
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

    expect(await approveBannerOrder(ctx, { orderId: created.id, actor })).toMatchObject({
      status: "active",
      endsAt: NOW + 7 * DAY,
    });
    expect(await approveBannerOrder(ctx, { orderId: created.id, actor })).toBeNull();
    expect(await listActivePromotions(db, NOW, "banner")).toMatchObject([{ banner }]);
    expect(await checkSlots(ctx, "banner")).toEqual({ available: 4, nextFreeAt: NOW + 7 * DAY });
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
    ]);
    expect(await rejectOrder(ctx, { orderId: created.id, actor })).toBeNull();
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "order.create",
      "order.paid",
      "order.reject",
      "order.refund",
    ]);
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
    expect(telegram).toEqual([]);
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

  test("products are validated on create and edit", async () => {
    const { ctx } = await setup();
    const product = {
      kind: "pin" as const,
      nameZh: " 置顶 1 天 ",
      nameEn: "Pin for 1 day",
      days: 1,
      priceStars: 100,
      priceUsdt: "2.5",
      slots: 3,
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
    expect((await runPromotionMaintenance(ctx, NOW + 6.6 * DAY)).expiringSoon).toEqual([]);

    const dispatchesBefore = dispatches.length;
    const done = await runPromotionMaintenance(ctx, NOW + 7 * DAY);
    expect(done.expired).toMatchObject([{ id: created.id, status: "expired", tgUserId: BUYER }]);
    expect(await listActivePromotions(db, 0)).toEqual([]);
    expect(await getSiteState(db, "dirty_since")).toBeDefined();
    expect(dispatches.length).toBe(dispatchesBefore + 1);
    expect((await auditRows()).filter((row) => row.actor === "system")).toEqual([
      { actor: "system", action: "order.cleanup", target: "orders" },
      { actor: "system", action: "promotion.expire", target: "promotions" },
    ]);
  });
});
