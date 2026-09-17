import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  createDb,
  insertApprovedEntry,
  listEntriesNeedingTranslation,
  setEntryStatus,
  setEntryTranslation,
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
    locale: "en",
    text: "A channel",
    now: NOW + 60_000,
  });
  expect(await usernames(10, NOW)).toEqual(["skewed"]);
  expect(await usernames(10, NOW + 120_000)).toEqual([]);
});

test("a skipped entry is stamped so it isn't retried until its description changes", async () => {
  const id = await listEntry("short", "hi", "en");
  expect((await stampTranslationSkipped(db, id, NOW)).rowsWritten).toBeGreaterThan(0);
  expect(await usernames()).toEqual([]);

  await updateEntryCold(db, id, { description: "A much longer description now" }, NOW + 1000);
  expect(await usernames()).toEqual(["short"]);
});

test("a new description drops both translations, another cold field keeps them", async () => {
  const id = await listEntry("news", "每天更新的资源频道", "zh");
  await setEntryTranslation(db, {
    entryId: id,
    locale: "en",
    text: "A daily resource channel",
    now: NOW,
  });
  await setEntryTranslation(db, {
    entryId: id,
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

test("only approved entries are translated", async () => {
  const id = await listEntry("hidden", "每天更新的资源频道", "zh");
  await setEntryStatus(db, id, "hidden_by_admin", NOW + 1);
  expect(await usernames()).toEqual([]);
});
