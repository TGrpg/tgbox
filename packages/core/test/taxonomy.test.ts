import { env } from "cloudflare:workers";
import {
  deleteCategory,
  deleteTag,
  reorderCategories,
  upsertCategory,
  upsertTag,
} from "@tgbox/core";
import {
  createSubmission,
  getEntryTagIds,
  getSiteState,
  insertApprovedEntry,
  listCategoriesWithCounts,
  listTags,
  listTagsWithCounts,
  searchEntries,
} from "@tgbox/db";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

async function kindCategories(kind: "channel" | "group" | "bot") {
  return (await listCategoriesWithCounts(db)).filter((row) => row.category.kind === kind);
}

async function tagId(slug: string) {
  const tag = (await listTags(db)).find((row) => row.slug === slug);
  if (!tag) throw new Error(`no tag ${slug}`);
  return tag.id;
}

async function listed(username: string, categoryId: number, tagIds: number[] = []) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: "channel",
      categoryId,
      title: username,
      description: "",
      listedAt: NOW,
    },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
    tagIds,
    now: NOW,
  });
  return id;
}

describe("categories", () => {
  test("a new category is appended to its kind, audited and marks the site dirty", async () => {
    const { ctx, dispatches } = await setup();
    const before = await kindCategories("bot");

    const result = await upsertCategory(ctx, {
      kind: "bot",
      slug: " Finance ",
      nameZh: "财经",
      nameEn: "Finance",
      icon: "discount",
      actor,
    });
    if (!result.ok) throw new Error(result.error);

    const after = await kindCategories("bot");
    expect(after.at(-1)?.category).toMatchObject({
      id: result.id,
      slug: "finance",
      icon: "discount",
      sort: Math.max(...before.map((row) => row.category.sort)) + 10,
    });
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches).toHaveLength(1);
    expect(await auditRows()).toEqual([
      {
        actor: "email:admin@example.com",
        action: "category.create",
        target: `category:${result.id}`,
      },
    ]);

    expect(
      await upsertCategory(ctx, {
        kind: "bot",
        slug: "finance",
        nameZh: "x",
        nameEn: "x",
        icon: null,
        actor,
      }),
    ).toEqual({ ok: false, error: "slug_taken" });
    // Slugs repeat across kinds.
    expect(
      await upsertCategory(ctx, {
        kind: "group",
        slug: "finance",
        nameZh: "财经",
        nameEn: "Finance",
        icon: null,
        actor,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await upsertCategory(ctx, {
        kind: "group",
        slug: "ok",
        nameZh: "x",
        nameEn: "x",
        icon: "nope",
        actor,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await upsertCategory(ctx, {
        kind: "group",
        slug: "bad slug",
        nameZh: "x",
        nameEn: "x",
        icon: null,
        actor,
      }),
    ).toEqual({ ok: false, error: "invalid" });
  });

  test("editing writes only real changes and rejects a slug used in the same kind", async () => {
    const { ctx } = await setup();
    const [news, video] = await kindCategories("channel");
    if (!news || !video) throw new Error("seed missing");
    const same = { ...news.category, actor };

    expect(await upsertCategory(ctx, same)).toEqual({
      ok: true,
      id: news.category.id,
      changed: false,
    });
    expect(await auditRows()).toEqual([]);

    expect(await upsertCategory(ctx, { ...same, nameEn: "Headlines", icon: null })).toEqual({
      ok: true,
      id: news.category.id,
      changed: true,
    });
    expect((await kindCategories("channel"))[0]?.category).toMatchObject({
      nameEn: "Headlines",
      icon: null,
    });
    expect(await upsertCategory(ctx, { ...same, slug: video.category.slug })).toEqual({
      ok: false,
      error: "slug_taken",
    });
    expect(await upsertCategory(ctx, { ...same, id: 999_999 })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  test("reordering rewrites sort for one kind only where it changed", async () => {
    const { ctx } = await setup();
    const ids = (await kindCategories("group")).map((row) => row.category.id);
    const reversed = [...ids].reverse();

    const { changed } = await reorderCategories(ctx, { kind: "group", ids: reversed, actor });
    expect(changed).toBeGreaterThan(0);
    expect((await kindCategories("group")).map((row) => row.category.id)).toEqual(reversed);
    expect(await reorderCategories(ctx, { kind: "group", ids: reversed, actor })).toEqual({
      changed: 0,
    });
    // Ids of another kind are ignored.
    const channelIds = (await kindCategories("channel")).map((row) => row.category.id);
    await reorderCategories(ctx, { kind: "group", ids: [...channelIds].reverse(), actor });
    expect((await kindCategories("channel")).map((row) => row.category.id)).toEqual(channelIds);
    expect((await auditRows()).map((row) => row.action)).toEqual(["category.reorder"]);
  });

  test("a category in use by an entry or a pending submission can't be deleted", async () => {
    const { ctx } = await setup();
    const [first, second, third] = await kindCategories("channel");
    if (!first || !second || !third) throw new Error("seed missing");
    await listed("in_use_channel", first.category.id);
    await createSubmission(db, {
      tgUserId: 1,
      username: "pending_one",
      kind: "channel",
      categoryId: second.category.id,
      tagIds: [],
      createdAt: NOW,
    });

    await listed("in_use_channel_2", first.category.id);
    const counts = await kindCategories("channel");
    expect(counts.map((row) => row.entries).slice(0, 3)).toEqual([2, 0, 0]);
    expect(await deleteCategory(ctx, { id: first.category.id, actor })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect(await deleteCategory(ctx, { id: second.category.id, actor })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect(await deleteCategory(ctx, { id: third.category.id, actor })).toEqual({ ok: true });
    expect((await kindCategories("channel")).map((row) => row.category.id)).not.toContain(
      third.category.id,
    );
    expect(await deleteCategory(ctx, { id: third.category.id, actor })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await auditRows()).map((row) => row.action)).toEqual(["category.delete"]);
  });
});

describe("tags", () => {
  test("renaming a tag updates search rows of tagged entries", async () => {
    const { ctx } = await setup();
    const id = await tagId("podcast");
    const entryId = await listed(
      "tag_rename",
      (await kindCategories("channel"))[0]?.category.id ?? 1,
      [id],
    );

    const result = await upsertTag(ctx, {
      id,
      slug: "podcast",
      nameZh: "播客节目",
      nameEn: "Podcasts",
      actor,
    });
    expect(result).toEqual({ ok: true, id, changed: true });
    expect((await searchEntries(db, "播客节目")).map((row) => row.entry.id)).toEqual([entryId]);
    expect(
      await upsertTag(ctx, { id, slug: "podcast", nameZh: "播客节目", nameEn: "Podcasts", actor }),
    ).toEqual({
      ok: true,
      id,
      changed: false,
    });
    expect(await upsertTag(ctx, { id, slug: "music", nameZh: "x", nameEn: "x", actor })).toEqual({
      ok: false,
      error: "slug_taken",
    });
    expect((await auditRows()).map((row) => row.action)).toEqual(["tag.update"]);
  });

  test("creating and deleting a tag removes it from entries and search", async () => {
    const { ctx, dispatches } = await setup();
    const created = await upsertTag(ctx, {
      slug: "radio",
      nameZh: "电台广播",
      nameEn: "Radio",
      actor,
    });
    if (!created.ok) throw new Error(created.error);
    const keep = await tagId("music");
    const entryId = await listed(
      "tag_delete",
      (await kindCategories("channel"))[0]?.category.id ?? 1,
      [created.id, keep],
    );
    expect((await listTagsWithCounts(db)).find((row) => row.tag.id === created.id)?.entries).toBe(
      1,
    );
    expect((await searchEntries(db, "电台广播")).map((row) => row.entry.id)).toEqual([entryId]);

    expect(await deleteTag(ctx, { id: created.id, actor })).toEqual({
      ok: true,
      affectedEntries: 1,
    });
    expect(await getEntryTagIds(db, entryId)).toEqual([keep]);
    expect(await searchEntries(db, "电台广播")).toEqual([]);
    expect((await listTags(db)).some((row) => row.id === created.id)).toBe(false);
    expect(await deleteTag(ctx, { id: created.id, actor })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await auditRows()).map((row) => row.action)).toEqual(["tag.create", "tag.delete"]);
    expect(dispatches).toHaveLength(1);
    const ftsCount = await env.DB.prepare("SELECT count(*) AS n FROM entries_fts WHERE rowid = ?")
      .bind(entryId)
      .first("n");
    expect(ftsCount).toBe(1);
  });
});
