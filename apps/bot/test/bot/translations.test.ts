import { insertApprovedEntry, listEntriesNeedingTranslation } from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { translationSource } from "../../src/maintenance.ts";
import { db, type Harness, startHarness } from "./harness.ts";

const HOURLY = "0 * * * *";
// Not the digest hour, so only maintenance runs.
const NOON = Date.UTC(2026, 8, 17, 12);

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});

let nextId = 0;
async function listEntry(description: string, lang: string | null = null) {
  const username = `entry_${++nextId}_${Date.now() % 100000}`;
  await insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId: 1,
      title: username,
      description,
      lang,
      listedAt: NOON,
    },
    stats: { members: 10, online: null, activityTier: null, statsWrittenAt: NOON },
    tagIds: [],
    now: NOON,
  });
  return username;
}

const translationOf = async (username: string) =>
  await db.$client
    .prepare(
      "SELECT description_zh, description_en, description_translated_at FROM entries WHERE username = ?",
    )
    .bind(username)
    .first<{
      description_zh: string | null;
      description_en: string | null;
      description_translated_at: number | null;
    }>();

describe("translationSource", () => {
  test.each([
    [{ lang: "zh", description: "whatever" }, "zh"],
    [{ lang: "en", description: "每天更新" }, "en"],
    // Anything else falls back to "does it contain Han characters".
    [{ lang: null, description: "每天更新的资源频道" }, "zh"],
    [{ lang: null, description: "A daily resource channel" }, "en"],
    [{ lang: "ru", description: "Ежедневный канал" }, "en"],
    [{ lang: "ja", description: "毎日更新" }, "zh"],
  ])("%j → %s", (entry, expected) => {
    expect(translationSource(entry)).toBe(expected);
  });
});

describe("hourly description translations", () => {
  test("translates the missing direction and rebuilds the site", async () => {
    const chinese = await listEntry("每天更新的优质资源频道", "zh");
    const english = await listEntry("A channel with daily resources", "en");
    h.answerAi(() => ({ translated_text: "  translated text  " }));

    await h.scheduled(NOON, HOURLY);

    expect(h.aiCalls).toEqual([
      {
        model: "@cf/meta/m2m100-1.2b",
        inputs: {
          text: "每天更新的优质资源频道",
          source_lang: "zh",
          target_lang: "en",
        },
      },
      {
        model: "@cf/meta/m2m100-1.2b",
        inputs: {
          text: "A channel with daily resources",
          source_lang: "en",
          target_lang: "zh",
        },
      },
    ]);
    // Only the language the source text is *not* in is written; `description` stays the source.
    expect(await translationOf(chinese)).toMatchObject({
      description_zh: null,
      description_en: "translated text",
      description_translated_at: NOON,
    });
    expect(await translationOf(english)).toMatchObject({
      description_zh: "translated text",
      description_en: null,
    });
    // Nothing is left to do, and the new content is published.
    expect(await listEntriesNeedingTranslation(db, 10, NOON)).toEqual([]);
    expect(h.dispatches).toHaveLength(1);
  });

  test("at most 8 entries per run, oldest first", async () => {
    for (let i = 0; i < 10; i++) await listEntry(`每天更新的资源频道 ${i}`, "zh");
    await h.scheduled(NOON, HOURLY);
    expect(h.aiCalls).toHaveLength(8);

    h.reset();
    await h.scheduled(NOON + 60 * 60 * 1000, HOURLY);
    expect(h.aiCalls).toHaveLength(2);
  });

  test("descriptions that are too short or too long are stamped, not sent to the model", async () => {
    const short = await listEntry("短", "zh");
    const long = await listEntry("x".repeat(801), "en");
    await h.scheduled(NOON, HOURLY);

    expect(h.aiCalls).toEqual([]);
    expect(await translationOf(short)).toMatchObject({ description_translated_at: NOON });
    expect(await translationOf(long)).toMatchObject({ description_translated_at: NOON });
    // Stamped, so the next run leaves them alone — and no build is dispatched for nothing.
    expect(await listEntriesNeedingTranslation(db, 10, NOON)).toEqual([]);
    expect(h.dispatches).toEqual([]);
  });

  test("a model failure is confined to its own entry and retried next hour", async () => {
    const first = await listEntry("每天更新的资源频道 A", "zh");
    const second = await listEntry("每天更新的资源频道 B", "zh");
    let call = 0;
    h.answerAi(() => {
      call++;
      if (call === 1) throw new Error("inference failed");
      return { translated_text: "second translation" };
    });

    await h.scheduled(NOON, HOURLY);
    expect(h.aiCalls).toHaveLength(2);
    expect(await translationOf(first)).toMatchObject({
      description_en: null,
      description_translated_at: null,
    });
    expect(await translationOf(second)).toMatchObject({ description_en: "second translation" });
    expect((await listEntriesNeedingTranslation(db, 10, NOON)).map((row) => row.username)).toEqual([
      first,
    ]);
  });

  test("an empty answer leaves the entry for the next run", async () => {
    const entry = await listEntry("每天更新的资源频道", "zh");
    h.answerAi(() => ({}));
    await h.scheduled(NOON, HOURLY);
    expect(await translationOf(entry)).toMatchObject({ description_translated_at: null });
    expect(h.dispatches).toEqual([]);
  });

  test("the minute cron never translates", async () => {
    await listEntry("每天更新的资源频道", "zh");
    await h.scheduled(NOON + 60_000, "* * * * *");
    expect(h.aiCalls).toEqual([]);
  });
});
