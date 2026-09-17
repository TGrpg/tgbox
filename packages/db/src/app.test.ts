import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { createDb, loadAppOverview, recordClick } from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);
const DAY = 24 * 60 * 60 * 1000;
const USER = 900;

beforeEach(async () => {
  await env.DB.batch(
    ["submissions", "orders", "promotions", "promotion_clicks", "products", "user_prefs"].map(
      (table) => env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

const submission = (id: number, tgUserId: number, createdAt: number) =>
  env.DB.prepare(
    `INSERT INTO submissions (id, tg_user_id, username, kind, category_id, tag_ids, status, created_at)
     VALUES (?, ?, ?, 'channel', 1, '[]', 'approved', ?)`,
  ).bind(id, tgUserId, `chan${id}`, createdAt);

const order = (id: number, tgUserId: number) =>
  env.DB.prepare(
    `INSERT INTO orders (id, tg_user_id, product_id, kind, days, status, created_at)
     VALUES (?, ?, 1, 'pin', 7, 'active', ?)`,
  ).bind(id, tgUserId, NOW);

test("one batch answers with only this user's submissions and orders", async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO products (id, kind, name_zh, name_en, days, price_stars, price_usdt, slots)
       VALUES (1, 'pin', '置顶', 'Pin', 7, 100, '10', 3)`,
    ),
    submission(1, USER, NOW - 2 * DAY),
    submission(2, USER, NOW - 1000),
    submission(3, 901, NOW - 1000),
    order(10, USER),
    order(11, 901),
    env.DB.prepare(
      `INSERT INTO promotions (id, kind, order_id, entry_username, starts_at, ends_at, created_at)
       VALUES (5, 'pin', 10, 'devnotes', ?, ?, ?)`,
    ).bind(NOW, NOW + DAY, NOW),
    env.DB.prepare(
      "INSERT INTO user_prefs (tg_user_id, locale, updated_at) VALUES (?, 'en', ?)",
    ).bind(USER, NOW),
  ]);
  await recordClick(db, { promotionId: 5, day: "2026-09-17" });
  await recordClick(db, { promotionId: 5, day: "2026-09-17" });

  const overview = await loadAppOverview(db, { tgUserId: USER, since: NOW - DAY });

  expect(overview.submissions.map((row) => row.id)).toEqual([2, 1]);
  expect(overview.orders.map((row) => row.id)).toEqual([10]);
  expect(overview.submittedToday).toBe(1);
  expect(overview.clicksByOrder.get(10)).toBe(2);
  expect(overview.locale).toBe("en");
  expect(overview.productNames.get(1)?.nameEn).toBe("Pin");
});

test("a user with nothing yet reads as empty, not as an error", async () => {
  const overview = await loadAppOverview(db, { tgUserId: 4242, since: NOW - DAY });

  expect(overview).toMatchObject({ submissions: [], orders: [], submittedToday: 0, locale: null });
  expect(overview.clicksByOrder.size).toBe(0);
});

test("the user indexes are the ones the lookups use", async () => {
  const plan = async (sql: string) =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>()).results
      .map((row) => row.detail)
      .join(" ");

  expect(
    await plan("SELECT id FROM submissions WHERE tg_user_id = 900 ORDER BY id DESC LIMIT 50"),
  ).toContain("submissions_user");
  expect(
    await plan("SELECT id FROM orders WHERE tg_user_id = 900 ORDER BY id DESC LIMIT 50"),
  ).toContain("orders_user");
});
