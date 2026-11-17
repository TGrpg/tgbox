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
  listPromotionsOfOrders,
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
    expect((await endPromotionRows(db, [expired.id, pinA.id], NOW)).promotions).toHaveLength(2);
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

    // Ended early, half a day in: it stops showing then, and keeps its row and its order.
    const at = NOW + DAY / 2;
    const ended = await endPromotionRows(db, [id], at);
    expect(ended.orders).toMatchObject([{ id: order.id, status: "expired", tgUserId: 7 }]);
    expect(await getPromotion(db, id)).toMatchObject({
      orderId: order.id,
      endsAt: at,
      endedAt: at,
    });
    expect(await listActivePromotions(db, at)).toEqual([]);
    expect(await listExpiredPromotions(db, NOW + 2 * DAY)).toEqual([]);
    expect(await listPromotionsOfOrders(db, [order.id])).toMatchObject([{ id }]);
    // An ended promotion can't be revived by extending it, or ended twice.
    expect(await extendPromotionRow(db, id, 3 * DAY)).toBe(false);
    expect(await endPromotionRows(db, [id], NOW + DAY)).toEqual({ promotions: [], orders: [] });
  });

  test("an order or promotion id is never handed out again after its row is deleted", async () => {
    const first = await pinOrder();
    await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(first.id).run();
    expect((await pinOrder()).id).toBeGreaterThan(first.id);

    const promo = {
      kind: "pin" as const,
      orderId: null,
      startsAt: NOW,
      endsAt: NOW,
      createdAt: NOW,
    };
    const gone = await insertPromotion(db, promo);
    await env.DB.prepare("DELETE FROM promotions WHERE id = ?").bind(gone.id).run();
    expect((await insertPromotion(db, promo)).id).toBeGreaterThan(gone.id);
  });

  test("the migration starts the id sequences above every id the audit trail and clicks name", async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0024_order_ids"));
    if (!migration) throw new Error("migration missing");
    // As before the migration: plain rowid tables, the highest ids already deleted.
    await env.DB.batch(
      [
        "DROP TABLE orders",
        "DROP TABLE promotions",
        "DROP INDEX audit_usdt_unmatched",
        "CREATE TABLE orders (id integer PRIMARY KEY NOT NULL, tg_user_id integer NOT NULL, product_id integer NOT NULL, kind text NOT NULL, days integer NOT NULL, target_username text, banner text, status text DEFAULT 'pending' NOT NULL, provider text, amount text, currency text, invoice_id text, charge_id text, note text, created_at integer NOT NULL, paid_at integer, starts_at integer, ends_at integer, reminded_at integer)",
        "CREATE UNIQUE INDEX orders_provider_charge_unique ON orders (provider, charge_id) WHERE charge_id IS NOT NULL",
        "CREATE INDEX orders_user ON orders (tg_user_id, id)",
        "CREATE TABLE promotions (id integer PRIMARY KEY NOT NULL, kind text NOT NULL, order_id integer, entry_username text, banner text, starts_at integer NOT NULL, ends_at integer NOT NULL, created_at integer NOT NULL)",
        "INSERT INTO orders (id, tg_user_id, product_id, kind, days, created_at) VALUES (3, 7, 1, 'pin', 7, 1)",
        "INSERT INTO promotions (id, kind, starts_at, ends_at, created_at) VALUES (2, 'pin', 1, 2, 1)",
        "INSERT INTO audit_log (actor, action, target, created_at) VALUES ('tg:7', 'order.create', 'order:40', 1), ('system', 'promotion.start', 'promotion:12', 1)",
        "INSERT INTO promotion_clicks (promotion_id, day, clicks) VALUES (15, '2026-09-17', 3)",
      ].map((query) => env.DB.prepare(query)),
    );
    await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));

    expect(await getOrder(db, 3)).toMatchObject({ tgUserId: 7 });
    expect(await getPromotion(db, 2)).toMatchObject({ endsAt: 2, endedAt: null });
    expect((await pinOrder()).id).toBe(41);
    const promo = {
      kind: "pin" as const,
      orderId: null,
      startsAt: NOW,
      endsAt: NOW,
      createdAt: NOW,
    };
    expect((await insertPromotion(db, promo)).id).toBe(16);
    // The placeholders that moved the sequences are gone.
    const { results } = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM promotions) AS promotions",
    ).all();
    expect(results).toEqual([{ orders: 2, promotions: 2 }]);
  });
});
