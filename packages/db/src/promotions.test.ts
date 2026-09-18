import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import {
  countActivePromotions,
  countPaidOrders,
  createDb,
  createPendingOrder,
  deleteStalePendingOrders,
  earliestPromotionEnd,
  endPromotionRows,
  extendPromotionRow,
  getOrder,
  getPromotion,
  insertApprovedEntry,
  insertPromotion,
  listActivePromotions,
  listExpiredPromotions,
  listOrders,
  listOrdersToRemind,
  listProducts,
  markOrderPaidRow,
  markOrderReminded,
  setOrderInvoice,
  setOrderStatus,
  upsertProductRow,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await env.DB.batch(["orders", "promotions"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

const pinOrder = (createdAt = NOW, tgUserId = 7) =>
  createPendingOrder(db, {
    tgUserId,
    productId: 1,
    kind: "pin",
    days: 7,
    targetUsername: "some_channel",
    createdAt,
  });

describe("products", () => {
  test("seeded by the migration, editable, and filterable by active", async () => {
    const seeded = await listProducts(db);
    expect(
      seeded.map((p) => [p.kind, p.nameZh, p.days, p.priceStars, p.priceUsdt, p.slots]),
    ).toEqual([
      ["highlight", "高亮 7 天", 7, 240, "3", 30],
      ["highlight", "高亮 30 天", 30, 720, "9", 30],
      ["category_pin", "分类置顶 7 天", 7, 400, "5", 3],
      ["category_pin", "分类置顶 30 天", 30, 1200, "15", 3],
      ["pin", "全站置顶 7 天", 7, 800, "10", 10],
      ["pin", "全站置顶 30 天", 30, 2400, "30", 10],
      ["banner", "首页横幅 7 天", 7, 1600, "20", 5],
      ["banner", "首页横幅 30 天", 30, 4800, "60", 5],
      ["announcement", "顶部公告条 7 天", 7, 2400, "30", 1],
      ["announcement", "顶部公告条 30 天", 30, 7200, "90", 1],
    ]);
    expect(seeded.find((p) => p.kind === "pin")?.nameEn).toBe("Site-wide pin for 7 days");
    const bannerMonth = seeded.find((p) => p.kind === "banner" && p.days === 30);
    if (!bannerMonth) throw new Error("missing seed");
    expect(await upsertProductRow(db, { ...bannerMonth, active: false })).toBe(bannerMonth.id);
    expect(await upsertProductRow(db, { ...bannerMonth, id: 999 })).toBeNull();
    expect(await listProducts(db, { activeOnly: true })).toHaveLength(9);
  });
});

describe("orders", () => {
  test("marking paid applies once; the same charge cannot pay twice", async () => {
    const order = await pinOrder();
    expect(order.status).toBe("pending");
    expect(await setOrderInvoice(db, order.id, "inv-1")).toBe(true);

    const paid = {
      id: order.id,
      provider: "stars" as const,
      chargeId: "charge-1",
      amount: "500",
      currency: "XTR" as const,
      paidAt: NOW,
    };
    expect(await markOrderPaidRow(db, paid)).toBe(true);
    expect(await markOrderPaidRow(db, paid)).toBe(false);
    expect(await getOrder(db, order.id)).toMatchObject({
      status: "paid",
      invoiceId: "inv-1",
      chargeId: "charge-1",
    });
    expect(await setOrderInvoice(db, order.id, "inv-2")).toBe(false);

    const other = await pinOrder();
    await expect(markOrderPaidRow(db, { ...paid, id: other.id })).rejects.toThrow();
  });

  test("status changes are guarded by the expected current status", async () => {
    const { id } = await pinOrder();
    expect(await setOrderStatus(db, { id, from: "paid", to: "active" })).toBe(false);
    expect(
      await setOrderStatus(db, {
        id,
        from: "pending",
        to: "active",
        fields: { endsAt: NOW + DAY },
      }),
    ).toBe(true);
    expect(await getOrder(db, id)).toMatchObject({ status: "active", endsAt: NOW + DAY });
  });

  test("lists by status newest first with pagination", async () => {
    const a = await pinOrder();
    const b = await pinOrder();
    const c = await pinOrder();
    await setOrderStatus(db, { id: b.id, from: "pending", to: "paid" });

    const page1 = await listOrders(db, { status: "pending", page: 1, pageSize: 1 });
    expect(page1).toMatchObject({ total: 2, rows: [{ id: c.id }] });
    const page2 = await listOrders(db, { status: "pending", page: 2, pageSize: 1 });
    expect(page2.rows.map((row) => row.id)).toEqual([a.id]);
    expect((await listOrders(db, { page: 1 })).total).toBe(3);
    expect(await countPaidOrders(db, { kind: "pin" })).toBe(1);
  });

  test("stale pending orders are deleted; paid ones stay", async () => {
    const old = await pinOrder(NOW - 3 * DAY);
    const oldPaid = await pinOrder(NOW - 3 * DAY);
    await setOrderStatus(db, { id: oldPaid.id, from: "pending", to: "paid" });
    const fresh = await pinOrder(NOW);

    expect(await deleteStalePendingOrders(db, NOW - 2 * DAY)).toBe(1);
    expect(await getOrder(db, old.id)).toBeUndefined();
    expect(await getOrder(db, oldPaid.id)).toBeDefined();
    expect(await getOrder(db, fresh.id)).toBeDefined();
  });

  test("reminders list active orders ending within the window, once", async () => {
    const soon = await pinOrder();
    const later = await pinOrder();
    await setOrderStatus(db, {
      id: soon.id,
      from: "pending",
      to: "active",
      fields: { endsAt: NOW + HOUR },
    });
    await setOrderStatus(db, {
      id: later.id,
      from: "pending",
      to: "active",
      fields: { endsAt: NOW + 3 * DAY },
    });

    const due = await listOrdersToRemind(db, NOW, NOW + DAY);
    expect(due.map((row) => row.id)).toEqual([soon.id]);
    expect(await markOrderReminded(db, soon.id, NOW)).toBe(true);
    expect(await markOrderReminded(db, soon.id, NOW)).toBe(false);
    expect(await listOrdersToRemind(db, NOW, NOW + DAY)).toEqual([]);
  });
});

describe("promotions", () => {
  const promotion = (kind: "pin" | "banner", startsAt: number, endsAt: number) =>
    insertPromotion(db, {
      kind,
      orderId: null,
      entryUsername: kind === "pin" ? "some_channel" : null,
      banner: kind === "banner" ? { title: "T", subtitle: "S", href: "https://t.me/x" } : null,
      startsAt,
      endsAt,
      createdAt: startsAt,
    });

  test("active, counts, earliest end, expiry, extend and delete", async () => {
    const expired = await promotion("pin", NOW - 8 * DAY, NOW);
    const pinA = await promotion("pin", NOW - DAY, NOW + 2 * DAY);
    const pinB = await promotion("pin", NOW - 2 * DAY, NOW + DAY);
    const banner = await promotion("banner", NOW, NOW + 7 * DAY);

    expect((await listActivePromotions(db, NOW)).map((row) => row.id)).toEqual([
      pinB.id,
      pinA.id,
      banner.id,
    ]);
    expect(await listActivePromotions(db, NOW, "banner")).toMatchObject([
      { id: banner.id, banner: { title: "T" } },
    ]);
    expect(await countActivePromotions(db, { kind: "pin" }, NOW)).toBe(2);
    expect(await earliestPromotionEnd(db, { kind: "pin" }, NOW)).toBe(NOW + DAY);
    expect(await earliestPromotionEnd(db, { kind: "banner" }, NOW + 8 * DAY)).toBeNull();
    expect((await listExpiredPromotions(db, NOW)).map((row) => row.id)).toEqual([expired.id]);

    expect(await extendPromotionRow(db, pinB.id, 3 * DAY)).toBe(true);
    expect((await getPromotion(db, pinB.id))?.endsAt).toBe(NOW + 4 * DAY);
    expect((await endPromotionRows(db, [expired.id, pinA.id])).promotions).toHaveLength(2);
    expect(await countActivePromotions(db, { kind: "pin" }, NOW)).toBe(1);
  });

  test("category pins count per category, other kinds site-wide", async () => {
    await env.DB.batch(
      ["entries", "entry_stats", "entry_tags", "entries_fts"].map((t) =>
        env.DB.prepare(`DELETE FROM ${t}`),
      ),
    );
    const list = (username: string, categoryId: number) =>
      insertApprovedEntry(db, {
        entry: { username, kind: "channel", categoryId, title: username, listedAt: NOW },
        stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
        tagIds: [],
        now: NOW,
      });
    await list("news_a", 1);
    await list("news_b", 1);
    await list("games_a", 2);
    const pin = (entryUsername: string, endsAt: number) =>
      insertPromotion(db, {
        kind: "category_pin",
        orderId: null,
        entryUsername,
        banner: null,
        startsAt: NOW,
        endsAt,
        createdAt: NOW,
      });
    await pin("news_a", NOW + DAY);
    await pin("news_b", NOW + 2 * DAY);
    await pin("games_a", NOW + 3 * DAY);
    const news = { kind: "category_pin", categoryId: 1 } as const;
    expect(await countActivePromotions(db, news, NOW)).toBe(2);
    expect(await countActivePromotions(db, { ...news, categoryId: 2 }, NOW)).toBe(1);
    expect(await countActivePromotions(db, { kind: "category_pin" }, NOW)).toBe(3);
    expect(await earliestPromotionEnd(db, { ...news, categoryId: 2 }, NOW)).toBe(NOW + 3 * DAY);
    await createPendingOrder(db, {
      tgUserId: 1,
      productId: 1,
      kind: "category_pin",
      days: 7,
      targetUsername: "games_a",
      createdAt: NOW,
    }).then((order) =>
      markOrderPaidRow(db, {
        id: order.id,
        provider: "manual",
        chargeId: "x",
        amount: "5",
        currency: "USDT",
        paidAt: NOW,
      }),
    );
    expect(await countPaidOrders(db, news)).toBe(0);
    expect(await countPaidOrders(db, { ...news, categoryId: 2 })).toBe(1);
  });

  test("ending a promotion expires its active order in the same transaction", async () => {
    const order = await pinOrder();
    await setOrderStatus(db, { id: order.id, from: "pending", to: "active" });
    const { id } = await insertPromotion(db, {
      kind: "pin",
      orderId: order.id,
      entryUsername: "some_channel",
      startsAt: NOW,
      endsAt: NOW + DAY,
      createdAt: NOW,
    });

    const ended = await endPromotionRows(db, [id]);
    expect(ended.orders).toMatchObject([{ id: order.id, status: "expired", tgUserId: 7 }]);
    expect(await getPromotion(db, id)).toBeUndefined();
    expect(await endPromotionRows(db, [id])).toEqual({ promotions: [], orders: [] });
  });
});
