import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  createDb,
  insertApprovedEntry,
  listEntriesNeedingTranslation,
  setEntryStatus,
  setEntryTranslation,
  stampTranslationFailed,
  stampTranslationSkipped,
  updateEntryCold,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);

beforeEach(async () => {
  await env.DB.batch(
    ["entries", "entry_stats", "entry_tags", "entries_fts"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

async function listEntry(username: string, description: string, lang: string | null = null) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId: 1,
      title: username,
      description,
      lang,
      listedAt: NOW,
    },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
    tagIds: [],
    now: NOW,
  });
  return id;
}

const usernames = async (limit = 10, now = NOW) =>
  (await listEntriesNeedingTranslation(db, limit, now)).map((row) => row.username);

test("entries without a current translation are queued, oldest attempt first", async () => {
  const cn = await listEntry("cn_channel", "每天更新的资源频道", "zh");
  await listEntry("en_channel", "A channel about telegram", "en");
  await listEntry("empty_channel", "");

  // An empty description has nothing to translate.
  expect(await usernames()).toEqual(["cn_channel", "en_channel"]);
  expect(await listEntriesNeedingTranslation(db, 1, NOW)).toHaveLength(1);
  expect(await listEntriesNeedingTranslation(db, 0, NOW)).toEqual([]);

  await setEntryTranslation(db, {
    entryId: cn,
    description: "每天更新的资源频道",
    locale: "en",
    text: "A daily resource channel",
    now: NOW,
  });
  expect(await usernames()).toEqual(["en_channel"]);
  const [row] = await listEntriesNeedingTranslation(db, 10, NOW);
  expect(row).toMatchObject({ username: "en_channel", descriptionEn: null, descriptionZh: null });
});

test("a translation stamped in the future is retried instead of freezing the entry", async () => {
  const id = await listEntry("skewed", "一个频道", "zh");
  await setEntryTranslation(db, {
    entryId: id,
    description: "一个频道",
    locale: "en",
    text: "A channel",
    now: NOW + 60_000,
  });
  expect(await usernames(10, NOW)).toEqual(["skewed"]);
  expect(await usernames(10, NOW + 120_000)).toEqual([]);
});

test("a skipped entry is stamped so it isn't retried until its description changes", async () => {
  const id = await listEntry("short", "hi", "en");
  expect(
    (await stampTranslationSkipped(db, { entryId: id, description: "hi", now: NOW })).rowsWritten,
  ).toBeGreaterThan(0);
  expect(await usernames()).toEqual([]);

  // A new avatar or title is not a new description: no candidate, so no second stamp write.
  await updateEntryCold(db, id, { title: "Short", avatarVersion: "v2" }, NOW + 500);
  await setEntryStatus(db, id, "approved", NOW + 600);
  expect(await usernames(10, NOW + 700)).toEqual([]);

  await updateEntryCold(db, id, { description: "A much longer description now" }, NOW + 1000);
  expect(await usernames()).toEqual(["short"]);
});

test("a new description drops both translations, another cold field keeps them", async () => {
  const id = await listEntry("news", "每天更新的资源频道", "zh");
  await setEntryTranslation(db, {
    entryId: id,
    description: "每天更新的资源频道",
    locale: "en",
    text: "A daily resource channel",
    now: NOW,
  });
  await setEntryTranslation(db, {
    entryId: id,
    description: "每天更新的资源频道",
    locale: "zh",
    text: "每天更新的资源频道",
    now: NOW,
  });
  expect(await usernames()).toEqual([]);

  // A title-only refresh must not throw the translations away.
  await updateEntryCold(db, id, { title: "News HQ" }, NOW + 1000);
  const [kept] = await env.DB.prepare(
    "SELECT description_zh, description_en FROM entries WHERE id = ?",
  )
    .bind(id)
    .raw();
  expect(kept).toEqual(["每天更新的资源频道", "A daily resource channel"]);

  await updateEntryCold(db, id, { description: "改版后的简介" }, NOW + 2000);
  const [cleared] = await env.DB.prepare(
    "SELECT description_zh, description_en FROM entries WHERE id = ?",
  )
    .bind(id)
    .raw();
  expect(cleared).toEqual([null, null]);
  expect(await usernames()).toEqual(["news"]);
});

test("an entry the model keeps failing on goes behind the rest instead of blocking them", async () => {
  const stuck = await listEntry("stuck", "每天更新的资源频道", "zh");
  await listEntry("fresh_a", "每天更新的资源频道 A", "zh");
  await listEntry("fresh_b", "每天更新的资源频道 B", "zh");
  expect(await usernames(1)).toEqual(["stuck"]);

  await stampTranslationFailed(db, { entryId: stuck, description: "每天更新的资源频道", now: NOW });
  expect(await usernames()).toEqual(["fresh_a", "fresh_b", "stuck"]);
  expect(await usernames(1)).toEqual(["fresh_a"]);
});

test("an edit that leaves the description alone doesn't queue a translated entry again", async () => {
  const id = await listEntry("avatar_change", "每天更新的资源频道", "zh");
  await setEntryTranslation(db, {
    entryId: id,
    description: "每天更新的资源频道",
    locale: "en",
    text: "A channel",
    now: NOW,
  });
  await updateEntryCold(db, id, { title: "New title", avatarVersion: "v2" }, NOW + 1000);
  expect(await usernames()).toEqual([]);
});

test("a translation of the old text that lands after a description edit is dropped", async () => {
  const id = await listEntry("edited", "每天更新的资源频道", "zh");
  const [candidate] = await listEntriesNeedingTranslation(db, 1, NOW);
  if (!candidate) throw new Error("not queued");
  // While the model works on the old text, a refresh brings a new description.
  await updateEntryCold(db, id, { description: "改版后的全新简介" }, NOW + 1000);
  const outcome = { entryId: id, description: candidate.description, now: NOW + 2000 };
  expect(
    (await setEntryTranslation(db, { ...outcome, locale: "en", text: "Old" })).rowsWritten,
  ).toBe(0);
  expect((await stampTranslationFailed(db, outcome)).rowsWritten).toBe(0);
  expect((await stampTranslationSkipped(db, outcome)).rowsWritten).toBe(0);

  const [row] = await listEntriesNeedingTranslation(db, 1, NOW + 3000);
  expect(row).toMatchObject({
    username: "edited",
    description: "改版后的全新简介",
    descriptionEn: null,
    descriptionZh: null,
  });
});

test("the migration requeues entries whose description changed under the old rule, only those", async () => {
  const stale = await listEntry("stale", "每天更新的资源频道", "zh");
  const current = await listEntry("current", "每天更新的资源频道", "zh");
  const failed = await listEntry("failed", "每天更新的资源频道", "zh");
  const set = (id: number, sql: string) =>
    env.DB.prepare(`UPDATE entries SET ${sql} WHERE id = ?`).bind(id).run();
  // Old rule: the description changed after the attempt, both translations were dropped.
  await set(stale, `description_translated_at = ${NOW}, updated_at = ${NOW + 1000}`);
  await set(
    current,
    `description_translated_at = ${NOW}, description_en = 'x', updated_at = ${NOW + 1000}`,
  );
  await set(failed, `description_translated_at = ${-NOW}, updated_at = ${NOW + 1000}`);

  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0022_requeue"));
  if (!migration) throw new Error("migration missing");
  await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));

  const { results } = await env.DB.prepare(
    "SELECT username, description_translated_at AS at FROM entries ORDER BY id",
  ).all();
  expect(results).toEqual([
    { username: "stale", at: null },
    { username: "current", at: NOW },
    { username: "failed", at: -NOW },
  ]);
});

test("only approved entries are translated", async () => {
  const id = await listEntry("hidden", "每天更新的资源频道", "zh");
  await setEntryStatus(db, id, "hidden_by_admin", NOW + 1);
  expect(await usernames()).toEqual([]);
});
