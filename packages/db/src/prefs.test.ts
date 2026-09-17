import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  clearUserLocale,
  createDb,
  getSupportThread,
  getSupportThreadByTopic,
  getUserLocale,
  setUserLocale,
  touchSupportThread,
  upsertSupportThread,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await env.DB.batch(
    ["user_prefs", "support_threads"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});

test("a language preference is written once and cleared back to auto", async () => {
  expect(await getUserLocale(db, 42)).toBeNull();
  expect((await setUserLocale(db, 42, "en", NOW)).rowsWritten).toBeGreaterThan(0);
  expect(await getUserLocale(db, 42)).toBe("en");
  // Picking the same language again costs nothing.
  expect(await setUserLocale(db, 42, "en", NOW + 1)).toEqual({ rowsWritten: 0 });
  expect((await setUserLocale(db, 42, "zh", NOW + 2)).rowsWritten).toBeGreaterThan(0);
  expect(await getUserLocale(db, 42)).toBe("zh");
  await clearUserLocale(db, 42);
  expect(await getUserLocale(db, 42)).toBeNull();
});

test("an unknown stored locale reads as no preference", async () => {
  await env.DB.prepare("INSERT INTO user_prefs (tg_user_id, locale, updated_at) VALUES (7, ?, ?)")
    .bind("fr", NOW)
    .run();
  expect(await getUserLocale(db, 7)).toBeNull();
});

test("a support thread is looked up from both sides and touched at most hourly", async () => {
  expect(await getSupportThread(db, 42)).toBeUndefined();
  expect(
    (await upsertSupportThread(db, { tgUserId: 42, topicId: 7, now: NOW })).rowsWritten,
  ).toBeGreaterThan(0);
  expect(await getSupportThread(db, 42)).toMatchObject({ topicId: 7, updatedAt: NOW });
  expect(await getSupportThreadByTopic(db, 7)).toMatchObject({ tgUserId: 42 });
  expect(await getSupportThreadByTopic(db, 8)).toBeUndefined();

  // Same topic: nothing to write.
  expect(await upsertSupportThread(db, { tgUserId: 42, topicId: 7, now: NOW + 1 })).toEqual({
    rowsWritten: 0,
  });
  // Within the hour the relay writes nothing…
  expect(await touchSupportThread(db, { tgUserId: 42, now: NOW + HOUR, maxAgeMs: HOUR })).toEqual({
    rowsWritten: 0,
  });
  // …and refreshes the row once it is stale.
  const later = NOW + HOUR + 1;
  expect(
    (await touchSupportThread(db, { tgUserId: 42, now: later, maxAgeMs: HOUR })).rowsWritten,
  ).toBeGreaterThan(0);
  expect(await getSupportThread(db, 42)).toMatchObject({ updatedAt: later });

  // A topic recreated after being deleted replaces the old id.
  await upsertSupportThread(db, { tgUserId: 42, topicId: 9, now: later });
  expect(await getSupportThreadByTopic(db, 9)).toMatchObject({ tgUserId: 42 });
});
