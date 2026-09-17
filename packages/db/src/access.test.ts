import { env } from "cloudflare:workers";
import { categories as categoryDefs, tags as tagDefs } from "@tgbox/shared";
import { beforeAll, describe, expect, test } from "vitest";
import {
  addToBlacklist,
  approveSubmission,
  clearDirty,
  countSubmissionsSince,
  createDb,
  createSubmission,
  deleteBotDraft,
  findPendingSubmission,
  getBlacklistEntry,
  getBotDraft,
  getEntriesByIdRange,
  getEntryByUsername,
  getEntryTagIds,
  getMaxEntryId,
  getSiteState,
  insertApprovedEntry,
  listCategories,
  listTags,
  markDirty,
  putBotDraft,
  recordLivenessResult,
  rejectSubmission,
  removeFromBlacklist,
  searchEntries,
  setEntryStatus,
  setEntryTags,
  setSiteState,
  syncTaxonomy,
  updateEntryCold,
  upsertEntryStats,
} from "./index.ts";

const db = createDb(env.DB);
const NOW = Date.UTC(2026, 8, 17);
const HOUR = 60 * 60 * 1000;

let tagId: (slug: string) => number;
let channelCategoryId: number;

beforeAll(async () => {
  await syncTaxonomy(db);
  const tagRows = await listTags(db);
  tagId = (slug) => {
    const row = tagRows.find((tag) => tag.slug === slug);
    if (!row) throw new Error(`missing tag ${slug}`);
    return row.id;
  };
  const category = (await listCategories(db)).find(
    (row) => row.kind === "channel" && row.slug === "software",
  );
  if (!category) throw new Error("missing category");
  channelCategoryId = category.id;
});

async function approve(username: string, title: string, tagSlugs: string[] = []) {
  return insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId: channelCategoryId,
      title,
      description: "",
      listedAt: NOW,
    },
    stats: { members: 1000, online: null, activityTier: 2, statsWrittenAt: NOW },
    tagIds: tagSlugs.map((slug) => tagId(slug)),
    now: NOW,
  });
}

async function ftsRow(id: number) {
  return env.DB.prepare("SELECT title, username, tag_names FROM entries_fts WHERE rowid = ?")
    .bind(id)
    .first();
}

describe("taxonomy", () => {
  test("syncs all shared categories and tags, and a re-sync writes nothing", async () => {
    expect(await listCategories(db)).toHaveLength(categoryDefs.length);
    expect(await listTags(db)).toHaveLength(tagDefs.length);
    expect(await syncTaxonomy(db)).toEqual({ rowsWritten: 0 });
  });
});

describe("entries", () => {
  test("an approved entry is stored with stats, tags and a search row", async () => {
    const { id } = await approve("SoftChannel", "软件综合频道", ["free", "android"]);

    const entry = await getEntryByUsername(db, "softchannel");
    expect(entry).toMatchObject({ id, username: "softchannel", status: "approved" });
    expect(await getEntryTagIds(db, id)).toEqual(
      expect.arrayContaining([tagId("free"), tagId("android")]),
    );
    const [row] = await getEntriesByIdRange(db, id, id);
    expect(row?.stats).toMatchObject({ members: 1000, activityTier: 2 });
    expect(await getMaxEntryId(db)).toBeGreaterThanOrEqual(id);
    expect(await ftsRow(id)).toMatchObject({ title: "软件综合频道", username: "softchannel" });
  });

  test("unchanged stats upsert writes 0 rows; a change writes", async () => {
    const { id } = await approve("stats_chan", "Stats");
    const stats = { entryId: id, members: 1000, online: null, activityTier: 2 as const };

    expect(await upsertEntryStats(db, { ...stats, statsWrittenAt: NOW + HOUR })).toEqual({
      rowsWritten: 0,
    });
    const changed = await upsertEntryStats(db, { ...stats, members: 1100, statsWrittenAt: NOW });
    expect(changed.rowsWritten).toBeGreaterThan(0);
  });

  test("cold update without a change writes 0 rows", async () => {
    const { id } = await approve("cold_same", "Same title");
    const result = await updateEntryCold(
      db,
      id,
      { title: "Same title", description: "", verified: false, lang: null },
      NOW + HOUR,
    );
    expect(result).toEqual({ rowsWritten: 0 });
  });

  test("description change updates the entry but leaves the search row untouched", async () => {
    const { id } = await approve("cold_desc", "Desc title");
    const result = await updateEntryCold(
      db,
      id,
      { title: "Desc title", description: "new description" },
      NOW + HOUR,
    );
    // Only the entries row itself; an FTS rewrite would cost extra rows.
    expect(result.rowsWritten).toBe(1);
    expect((await getEntryByUsername(db, "cold_desc"))?.description).toBe("new description");
  });

  test("title change rewrites the search row", async () => {
    const { id } = await approve("cold_title", "Old title");
    const result = await updateEntryCold(db, id, { title: "新的标题频道" }, NOW + HOUR);
    expect(result.rowsWritten).toBeGreaterThan(1);
    expect(await ftsRow(id)).toMatchObject({ title: "新的标题频道" });
    expect(await searchEntries(db, "新的标题")).toHaveLength(1);
    expect(await searchEntries(db, "Old title")).toHaveLength(0);
  });

  test("tags: same set writes nothing; a new set updates the search row", async () => {
    const { id } = await approve("tagged_chan", "Tagged", ["music"]);
    expect(await setEntryTags(db, id, [tagId("music")], NOW)).toEqual({ rowsWritten: 0 });

    await setEntryTags(db, id, [tagId("anime")], NOW);
    expect(await getEntryTagIds(db, id)).toEqual([tagId("anime")]);
    expect(await ftsRow(id)).toMatchObject({ tag_names: "动漫 Anime" });
  });

  test("status change applies once", async () => {
    const { id } = await approve("status_chan", "Status");
    expect(await setEntryStatus(db, id, "hidden_by_admin", NOW)).toBe(true);
    expect(await setEntryStatus(db, id, "hidden_by_admin", NOW)).toBe(false);
  });
});

describe("liveness", () => {
  const current = async (username: string) => {
    const entry = await getEntryByUsername(db, username);
    if (!entry) throw new Error("missing entry");
    return entry;
  };

  test("a clean active entry and unknown results write nothing", async () => {
    await approve("live_clean", "Clean");
    for (const liveness of ["active", "unknown"] as const) {
      const result = await recordLivenessResult(db, await current("live_clean"), {
        liveness,
        now: NOW,
        allowHide: true,
      });
      expect(result.rowsWritten).toBe(0);
    }
  });

  test("not_found hides after 3 failures spanning 48 hours, then active restores", async () => {
    await approve("live_gone", "Gone");
    const check = (now: number) => ({ liveness: "not_found" as const, now, allowHide: true });

    await recordLivenessResult(db, await current("live_gone"), check(NOW));
    await recordLivenessResult(db, await current("live_gone"), check(NOW + HOUR));
    const early = await recordLivenessResult(db, await current("live_gone"), check(NOW + 2 * HOUR));
    expect(early.transition).toBeNull();
    const late = await recordLivenessResult(db, await current("live_gone"), check(NOW + 48 * HOUR));
    expect(late.transition).toBe("hidden");
    expect(await current("live_gone")).toMatchObject({
      status: "hidden_by_system",
      failCount: 4,
      firstFailAt: NOW,
    });

    const back = await recordLivenessResult(db, await current("live_gone"), {
      liveness: "active",
      now: NOW + 50 * HOUR,
      allowHide: true,
    });
    expect(back.transition).toBe("restored");
    expect(await current("live_gone")).toMatchObject({
      status: "approved",
      failCount: 0,
      firstFailAt: null,
    });
  });

  test("banned hides after 2 failures unless the batch guard is on", async () => {
    await approve("live_banned", "Banned");
    const check = { liveness: "banned" as const, now: NOW, allowHide: false };
    await recordLivenessResult(db, await current("live_banned"), check);
    const guarded = await recordLivenessResult(db, await current("live_banned"), check);
    expect(guarded.transition).toBeNull();
    expect((await current("live_banned")).status).toBe("approved");

    const hidden = await recordLivenessResult(db, await current("live_banned"), {
      ...check,
      allowHide: true,
    });
    expect(hidden.transition).toBe("hidden");
    expect((await current("live_banned")).status).toBe("hidden_by_system");
  });
});

describe("search", () => {
  test("long queries match phrases, short queries fall back to LIKE, approved only", async () => {
    await approve("ai_news_cn", "AI 中文资讯", ["chinese"]);
    await approve("soft_share", "软件分享站");
    const { id: hiddenId } = await approve("soft_hidden", "软件隐藏频道");
    await setEntryStatus(db, hiddenId, "hidden_by_admin", NOW);

    const usernames = async (query: string) =>
      (await searchEntries(db, query)).map((row) => row.entry.username).sort();

    expect(await usernames("AI 中文")).toEqual(["ai_news_cn"]);
    expect(await usernames("软件分享")).toEqual(["soft_share"]);
    expect(await usernames("分享")).toEqual(["soft_share"]);
    expect(await usernames("隐藏")).toEqual([]);
    expect(await usernames("中文")).toEqual(["ai_news_cn"]);
    expect(await usernames('"quoted')).toEqual([]);
    expect(await usernames("  ")).toEqual([]);
  });

  test("results are capped at 20", async () => {
    for (let i = 0; i < 22; i++) await approve(`many_chan_${i}`, `批量频道 ${i}`);
    expect(await searchEntries(db, "批量频道", 50)).toHaveLength(20);
    expect(await searchEntries(db, "批量", 50)).toHaveLength(20);
  });
});

describe("submissions", () => {
  const submission = (username: string, tgUserId = 42) => ({
    tgUserId,
    username,
    kind: "channel" as const,
    categoryId: channelCategoryId,
    tagIds: [tagId("free")],
    createdAt: NOW,
  });

  test("only one pending submission per username", async () => {
    const id = await createSubmission(db, submission("Pending_One"));
    expect(id).not.toBeNull();
    expect(await createSubmission(db, submission("pending_one", 43))).toBeNull();
    expect((await findPendingSubmission(db, "PENDING_ONE"))?.id).toBe(id);
  });

  test("concurrent approvals: exactly one applies", async () => {
    const id = await createSubmission(db, submission("race_chan"));
    if (id === null) throw new Error("not created");
    const results = await Promise.all([
      approveSubmission(db, id, 1, NOW),
      approveSubmission(db, id, 2, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rejectSubmission(db, id, 3, "late", NOW)).toBe(false);
    expect(await findPendingSubmission(db, "race_chan")).toBeUndefined();
  });

  test("daily count only includes the user's submissions since the cutoff", async () => {
    await createSubmission(db, { ...submission("count_a", 777), createdAt: NOW - 25 * HOUR });
    await createSubmission(db, submission("count_b", 777));
    await createSubmission(db, submission("count_c", 777));
    expect(await countSubmissionsSince(db, 777, NOW - 24 * HOUR)).toBe(2);
  });
});

describe("blacklist, drafts, site state", () => {
  test("blacklist add/get/remove", async () => {
    expect(
      await addToBlacklist(db, { type: "username", value: "Spam", reason: null, now: NOW }),
    ).toBe(true);
    expect(
      await addToBlacklist(db, { type: "username", value: "spam", reason: null, now: NOW }),
    ).toBe(false);
    expect(await getBlacklistEntry(db, "username", "SPAM")).toBeDefined();
    expect(await removeFromBlacklist(db, "username", "spam")).toBe(true);
    expect(await getBlacklistEntry(db, "username", "spam")).toBeUndefined();
  });

  test("drafts expire after 24 hours", async () => {
    await putBotDraft(db, {
      tgUserId: 9,
      step: "awaiting_link",
      payload: { v: 1 },
      updatedAt: NOW,
    });
    expect(await getBotDraft(db, 9, NOW + HOUR)).toMatchObject({ payload: { v: 1 } });
    expect(await getBotDraft(db, 9, NOW + 25 * HOUR)).toBeUndefined();
    await deleteBotDraft(db, 9);
    expect(await getBotDraft(db, 9, NOW)).toBeUndefined();
  });

  test("site state set is write-free when unchanged", async () => {
    await setSiteState(db, "last_dispatch_at", "1");
    expect(await setSiteState(db, "last_dispatch_at", "1")).toEqual({ rowsWritten: 0 });
    expect(await getSiteState(db, "last_dispatch_at")).toBe("1");
  });

  test("markDirty dispatches only on the empty → dirty transition", async () => {
    expect(await markDirty(db, NOW)).toBe(true);
    expect(await markDirty(db, NOW + 1)).toBe(false);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    // A build that started before the change must not clear it.
    expect(await clearDirty(db, NOW)).toBe(false);
    expect(await clearDirty(db, NOW + 10)).toBe(true);
    expect(await markDirty(db, NOW + 20)).toBe(true);
  });
});
