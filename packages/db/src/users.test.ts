import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import {
  botUserStats,
  claimBroadcastBatch,
  countAudience,
  createDb,
  getBotUserDetail,
  getBotUserProfiles,
  getBroadcast,
  insertBroadcast,
  listBotUsers,
  markBotUsersBlocked,
  recordBroadcastBatch,
  setBotUserAvatar,
  touchBotUser,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17, 12);
const DAY = 24 * 60 * 60 * 1000;

const alice: Parameters<typeof touchBotUser>[1] = {
  tgUserId: 11,
  firstName: "Alice",
  lastName: null,
  username: "alice",
  languageCode: "en",
  now: NOW,
};

beforeEach(async () => {
  await env.DB.batch(
    ["bot_users", "broadcasts", "blacklist", "orders", "submissions", "user_prefs"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

async function seed(id: number, fields: Partial<typeof alice> = {}) {
  await touchBotUser(db, {
    ...alice,
    tgUserId: id,
    username: `user${id}`,
    firstName: `User ${id}`,
    ...fields,
  });
}

describe("recording users", () => {
  test("a user costs a row when new, nothing again that day, and a row on a new day", async () => {
    expect((await touchBotUser(db, alice)).rowsWritten).toBeGreaterThan(0);
    expect(await touchBotUser(db, { ...alice, now: NOW + 1000 })).toEqual({ rowsWritten: 0 });
    expect((await touchBotUser(db, { ...alice, now: NOW + DAY })).rowsWritten).toBeGreaterThan(0);
    // First seen stays the first time.
    expect(await getBotUserDetail(db, 11)).toMatchObject({ firstSeenAt: NOW });
  });

  test("a changed profile is written the same day", async () => {
    await touchBotUser(db, alice);
    expect(
      (await touchBotUser(db, { ...alice, username: "alice_new" })).rowsWritten,
    ).toBeGreaterThan(0);
    expect(await getBotUserDetail(db, 11)).toMatchObject({ username: "alice_new" });
  });

  test("a user who blocked the bot is reachable again once they write", async () => {
    await touchBotUser(db, alice);
    await markBotUsersBlocked(db, [11], NOW);
    expect(await countAudience(db, "all", NOW)).toBe(0);
    await touchBotUser(db, { ...alice, now: NOW + 1 });
    expect(await countAudience(db, "all", NOW)).toBe(1);
  });
});

describe("profiles", () => {
  test("known users come back with their avatar state; unknown ids are left out", async () => {
    await touchBotUser(db, alice);
    await setBotUserAvatar(db, { tgUserId: 11, avatarKey: "users/abc.jpg", now: NOW });
    expect(await getBotUserProfiles(db, [11, 99])).toEqual([
      {
        tgUserId: 11,
        firstName: "Alice",
        lastName: null,
        username: "alice",
        avatarKey: "users/abc.jpg",
        avatarCheckedAt: NOW,
      },
    ]);
    expect(await getBotUserProfiles(db, [])).toEqual([]);
  });
});

describe("admin list", () => {
  test("filters, search and per-user totals", async () => {
    await seed(1);
    await seed(2, { username: "Painter", firstName: "Bob" });
    await seed(3);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO submissions (tg_user_id, username, kind, category_id, tag_ids, status, created_at) VALUES (1, 'a', 'channel', 1, '[]', 'approved', 1), (1, 'b', 'channel', 1, '[]', 'rejected', 2)",
      ),
      env.DB.prepare(
        "INSERT INTO orders (tg_user_id, product_id, kind, days, status, amount, currency, created_at) VALUES (2, 1, 'pin', 7, 'active', '10', 'USDT', 1), (2, 1, 'pin', 7, 'pending', '10', 'USDT', 2)",
      ),
      env.DB.prepare("INSERT INTO blacklist (type, value, created_at) VALUES ('user', '3', 1)"),
    ]);

    const all = await listBotUsers(db, { page: 1, filter: "all", search: "" });
    expect(all.total).toBe(3);
    const one = all.rows.find((row) => row.tgUserId === 1);
    expect(one?.submissions).toEqual({ approved: 1, rejected: 1, pending: 0 });
    const two = all.rows.find((row) => row.tgUserId === 2);
    // Unpaid orders don't count as spend.
    expect(two).toMatchObject({ orders: 1, spend: [{ currency: "USDT", amount: 10 }] });

    const ids = async (filter: Parameters<typeof listBotUsers>[1]["filter"], search = "") =>
      (await listBotUsers(db, { page: 1, filter, search })).rows.map((row) => row.tgUserId);
    expect(await ids("submitters")).toEqual([1]);
    expect(await ids("paying")).toEqual([2]);
    expect(await ids("blacklisted")).toEqual([3]);
    expect(await ids("all", "@painter")).toEqual([2]);
    expect(await ids("all", "bob")).toEqual([2]);
    expect(await ids("all", "3")).toEqual([3]);
    expect(await ids("all", "100%")).toEqual([]);
  });

  test("dashboard counts", async () => {
    await seed(1, { now: NOW - 30 * DAY });
    await seed(2);
    await env.DB.prepare(
      "INSERT INTO orders (tg_user_id, product_id, kind, days, status, created_at) VALUES (2, 1, 'pin', 7, 'expired', 1), (2, 1, 'pin', 7, 'paid', 2)",
    ).run();
    expect(await botUserStats(db, NOW)).toEqual({ total: 2, new7d: 1, paying: 1 });
  });
});

describe("broadcasts", () => {
  test("audiences follow /lang first, then the client language, and skip the unreachable", async () => {
    await seed(1, { languageCode: "en-US" });
    await seed(2, { languageCode: "zh-hans" });
    await seed(3, { languageCode: null });
    await seed(4, { languageCode: "en" });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO user_prefs (tg_user_id, locale, updated_at) VALUES (2, 'en', 1)"),
      env.DB.prepare("INSERT INTO blacklist (type, value, created_at) VALUES ('user', '4', 1)"),
    ]);
    expect(await countAudience(db, "all", NOW)).toBe(3);
    expect(await countAudience(db, "en", NOW)).toBe(2);
    expect(await countAudience(db, "zh", NOW)).toBe(1);
    expect(await countAudience(db, "paying", NOW)).toBe(0);
    expect(await countAudience(db, "submitters", NOW)).toBe(0);
    // Users seen within the last 30 days; seed() dates everyone NOW.
    expect(await countAudience(db, "active30", NOW + 29 * DAY)).toBe(3);
    expect(await countAudience(db, "active30", NOW + 31 * DAY)).toBe(0);
  });

  test("batches walk the audience once; a racing claim gets nothing; a rewind resends", async () => {
    for (const id of [1, 2, 3, 4, 5]) await seed(id);
    const created = await insertBroadcast(db, {
      text: "hi",
      format: "plain",
      media: null,
      buttons: [],
      buttonsPerRow: 1,
      silent: false,
      protect: false,
      noPreview: false,
      audience: "all",
      total: 5,
      createdBy: "system",
      now: NOW,
      startAt: NOW,
    });
    const lease = { limit: 2, now: NOW, leaseMs: 60_000 };
    expect(await claimBroadcastBatch(db, created, lease)).toEqual([1, 2]);
    // The same stale view of the cursor (a second sender) claims nothing.
    expect(await claimBroadcastBatch(db, created, lease)).toBeNull();
    // Held by the lease until the batch is recorded.
    const leased = await getBroadcast(db, created.id);
    if (!leased) throw new Error("missing");
    expect(await claimBroadcastBatch(db, leased, lease)).toBeNull();

    await recordBroadcastBatch(db, {
      id: created.id,
      sent: 2,
      failed: 0,
      blocked: 0,
      done: false,
      now: NOW,
    });
    const second = await getBroadcast(db, created.id);
    if (!second) throw new Error("missing");
    expect(await claimBroadcastBatch(db, second, lease)).toEqual([3, 4]);
    // Rate-limited after 3: 4 goes back to the queue.
    await recordBroadcastBatch(db, {
      id: created.id,
      sent: 1,
      failed: 0,
      blocked: 0,
      rewindTo: 3,
      notBefore: NOW + 5000,
      done: false,
      now: NOW,
    });
    const third = await getBroadcast(db, created.id);
    if (!third) throw new Error("missing");
    expect(await claimBroadcastBatch(db, third, lease)).toBeNull();
    expect(await claimBroadcastBatch(db, third, { ...lease, now: NOW + 5000 })).toEqual([4, 5]);
    await recordBroadcastBatch(db, {
      id: created.id,
      sent: 2,
      failed: 0,
      blocked: 0,
      done: false,
      now: NOW,
    });
    const last = await getBroadcast(db, created.id);
    if (!last) throw new Error("missing");
    expect(await claimBroadcastBatch(db, last, { ...lease, now: NOW + 5000 })).toEqual([]);
    await recordBroadcastBatch(db, {
      id: created.id,
      sent: 0,
      failed: 0,
      blocked: 0,
      done: true,
      now: NOW,
    });
    expect(await getBroadcast(db, created.id)).toMatchObject({ status: "done", sent: 5 });
  });
});
