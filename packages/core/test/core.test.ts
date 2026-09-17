import { env } from "cloudflare:workers";
import {
  addBlacklist,
  approveSubmission,
  dispatchStaleBuild,
  listApprovedSubmission,
  listEntryManually,
  markDirtyAndDispatch,
  refreshEntryNow,
  rejectSubmission,
  removeBlacklist,
  setEntriesStatus,
  setEntryCategoryAndTags,
  setPromoted,
  tgActor,
  triggerBuild,
} from "@tgbox/core";
import {
  createSubmission,
  getBlacklistEntry,
  getEntryByUsername,
  getEntryTagIds,
  getSiteState,
  getSubmission,
  insertApprovedEntry,
  listCategories,
  listTags,
} from "@tgbox/db";
import { PostView } from "@tgbox/shared";
import { describe, expect, test, vi } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const MINUTE = 60_000;

async function pendingSubmission(username = "review_me") {
  const tagIds = (await listTags(db)).slice(0, 2).map((tag) => tag.id);
  const id = await createSubmission(db, {
    tgUserId: 4242,
    username,
    kind: "channel",
    categoryId: 1,
    tagIds,
    fetchedTitle: "Review Me",
    fetchedMembers: 10,
    createdAt: NOW,
  });
  if (id === null) throw new Error("submission not created");
  return id;
}

async function listedEntry(username: string, title = username) {
  const { id } = await insertApprovedEntry(db, {
    entry: { username, kind: "channel", categoryId: 1, title, description: "", listedAt: NOW - 1 },
    stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW - 1 },
    tagIds: [],
    now: NOW - 1,
  });
  return id;
}

describe("reviewing submissions", () => {
  test("approval by a web admin lists the entry, marks dirty, dispatches once and is audited", async () => {
    const { ctx, dispatches } = await setup();
    const id = await pendingSubmission();

    const approved = await approveSubmission(ctx, { id, actor });
    expect(approved).toMatchObject({ status: "approved", reviewerId: null });
    expect(await approveSubmission(ctx, { id, actor })).toBeNull();
    if (!approved) throw new Error("not approved");

    const listed = await listApprovedSubmission(ctx, approved);
    expect(listed.created).toBe(true);
    expect(await getEntryByUsername(db, "review_me")).toMatchObject({
      id: listed.entryId,
      title: "Telegram News",
      status: "approved",
    });
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(dispatches).toEqual(["/repos/owner/tgbox/dispatches"]);
    expect(await auditRows()).toEqual([
      {
        actor: "email:admin@example.com",
        action: "submission.approve",
        target: `submission:${id}`,
      },
    ]);
  });

  test("rejection by a Telegram admin records the reviewer and reason", async () => {
    const { ctx } = await setup();
    const id = await pendingSubmission();

    expect(await rejectSubmission(ctx, { id, reason: "grey", actor: tgActor(900) })).toMatchObject({
      status: "rejected",
    });
    expect(await getSubmission(db, id)).toMatchObject({ reviewerId: 900, rejectReason: "grey" });
    expect(await rejectSubmission(ctx, { id, reason: "grey", actor })).toBeNull();
    expect(await auditRows()).toHaveLength(1);
  });
});

describe("manual listing", () => {
  test("fetches the profile and lists it in the chosen category with tags", async () => {
    const { ctx, dispatches } = await setup();
    const [tag] = await listTags(db);
    if (!tag) throw new Error("no tags");

    const result = await listEntryManually(ctx, {
      username: "https://t.me/Some_Group",
      categorySlug: "software",
      tagSlugs: [tag.slug],
      actor,
    });
    if (!result.ok) throw new Error(result.error);
    const entry = await getEntryByUsername(db, "some_group");
    const category = (await listCategories(db)).find((row) => row.id === entry?.categoryId);
    expect(entry).toMatchObject({ kind: "group", status: "approved" });
    expect(category).toMatchObject({ kind: "group", slug: "software" });
    expect(await getEntryTagIds(db, result.entryId)).toEqual([tag.id]);
    expect(dispatches).toHaveLength(1);
    expect(await auditRows()).toEqual([
      { actor: "email:admin@example.com", action: "entry.list", target: `entry:${result.entryId}` },
    ]);
  });

  test.each([
    ["some_user", "software", "user_account"],
    ["gone_away", "software", "not_found"],
    ["banned_one", "software", "banned"],
    ["some_channel", "no_such_category", "unknown_category"],
    ["not a link!", "software", "invalid_username"],
  ])("%s in %s is refused with %s", async (username, categorySlug, error) => {
    const { ctx } = await setup();
    expect(await listEntryManually(ctx, { username, categorySlug, tagSlugs: [], actor })).toEqual({
      ok: false,
      error,
    });
    expect(await auditRows()).toEqual([]);
  });

  test("an already listed username is refused without fetching t.me", async () => {
    const { ctx, tme } = await setup();
    await listedEntry("taken_name");
    expect(
      await listEntryManually(ctx, {
        username: "@taken_name",
        categorySlug: "news",
        tagSlugs: [],
        actor,
      }),
    ).toEqual({ ok: false, error: "already_listed" });
    expect(tme).toEqual([]);
  });
});

describe("entry changes", () => {
  test("bulk status change reports and audits only changed entries; dispatch is debounced", async () => {
    const { ctx, dispatches } = await setup();
    const a = await listedEntry("entry_a");
    const b = await listedEntry("entry_b");

    expect(await setEntriesStatus(ctx, { ids: [a, b], status: "hidden_by_admin", actor })).toEqual({
      changed: [a, b],
    });
    expect(await setEntriesStatus(ctx, { ids: [a], status: "hidden_by_admin", actor })).toEqual({
      changed: [],
    });
    expect(await setPromoted(ctx, { ids: [b], promoted: true, actor })).toEqual({ changed: [b] });
    expect(dispatches).toHaveLength(1);
    expect(await auditRows()).toEqual([
      { actor: "email:admin@example.com", action: "entry.status", target: "entries" },
      { actor: "email:admin@example.com", action: "entry.promote", target: `entry:${b}` },
    ]);
  });

  test("category and tag edits report what changed", async () => {
    const { ctx } = await setup();
    const id = await listedEntry("editable");
    const [tag] = await listTags(db);
    if (!tag) throw new Error("no tags");

    expect(
      await setEntryCategoryAndTags(ctx, { id, categoryId: 2, tagIds: [tag.id], actor }),
    ).toEqual({ categoryChanged: true, tagsChanged: true });
    expect(
      await setEntryCategoryAndTags(ctx, { id, categoryId: 2, tagIds: [tag.id], actor }),
    ).toEqual({ categoryChanged: false, tagsChanged: false });
  });

  test("refresh now updates cold fields, stats and R2 media from t.me", async () => {
    const { ctx } = await setup();
    const id = await listedEntry("stale_channel", "Old title");
    const media = env.MEDIA;
    await media.delete(["posts/stale_channel.json", "avatars/stale_channel.jpg"]);

    const result = await refreshEntryNow(ctx, { id, actor, media });
    expect(result).toMatchObject({ liveness: "active" });
    expect(result?.r2Writes).toBeGreaterThan(0);
    const entry = await getEntryByUsername(db, "stale_channel");
    expect(entry).toMatchObject({ title: "Telegram News" });
    expect(entry?.avatarVersion).not.toBeNull();
    expect(await media.head("avatars/stale_channel.jpg")).not.toBeNull();
    const posts = PostView.array().parse(
      await (await media.get("posts/stale_channel.json"))?.json(),
    );
    expect(posts.length).toBeGreaterThan(0);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));

    // Nothing changed on t.me: a second manual refresh writes nothing.
    expect(await refreshEntryNow(ctx, { id, actor, media })).toMatchObject({
      rowsWritten: 0,
      r2Writes: 0,
    });
    expect(await refreshEntryNow(ctx, { id: 999_999, actor, media })).toBeNull();
  });
});

describe("build and blacklist", () => {
  test("a manual build dispatches even when the site is already dirty", async () => {
    const { ctx, dispatches } = await setup();
    expect(await triggerBuild(ctx, { actor })).toEqual({ dispatched: true });
    expect(await triggerBuild(ctx, { actor })).toEqual({ dispatched: true });
    expect(dispatches).toHaveLength(2);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
  });

  test("without a GitHub repo nothing is dispatched or recorded", async () => {
    const { ctx, dispatches } = await setup({ GITHUB_REPO: "" });
    expect(await triggerBuild(ctx, { actor })).toEqual({ dispatched: false });
    expect(dispatches).toEqual([]);
    expect(await getSiteState(db, "build_dispatched_at")).toBeUndefined();
  });

  test("a change while the site is already dirty dispatches once the last build is 3 min old", async () => {
    const { ctx, dispatches } = await setup();
    let clock = NOW;
    const at = { ...ctx, now: () => clock };

    // The site was left dirty by an earlier cron run that did dispatch.
    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(1);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(NOW));

    clock = NOW + 2 * MINUTE;
    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(1);

    clock = NOW + 4 * MINUTE;
    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(2);
    expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(NOW + 4 * MINUTE));
  });

  test("a refused dispatch is not recorded, so the next change retries right away", async () => {
    const { ctx, dispatches, github } = await setup();
    let clock = NOW;
    const at = { ...ctx, now: () => clock };
    github.status = 401;
    github.body = JSON.stringify({ message: "Bad credentials" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(1);
    expect(await getSiteState(db, "build_dispatched_at")).toBeUndefined();
    expect(logged).toHaveBeenCalledWith("github dispatch failed", 401, "Bad credentials");

    // Within the throttle window, but nothing has been published yet.
    clock = NOW + MINUTE;
    github.status = 204;
    github.body = "";
    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(2);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(NOW + MINUTE));
    logged.mockRestore();
  });

  test("the hourly safety net rebuilds only while dirty with a stale dispatch", async () => {
    const { ctx, dispatches } = await setup();
    let clock = NOW;
    const at = { ...ctx, now: () => clock };

    // Nothing to publish.
    expect(await dispatchStaleBuild(at)).toBe(false);
    expect(dispatches).toEqual([]);

    await markDirtyAndDispatch(at);
    expect(dispatches).toHaveLength(1);

    clock = NOW + 29 * MINUTE;
    expect(await dispatchStaleBuild(at)).toBe(false);
    clock = NOW + 31 * MINUTE;
    expect(await dispatchStaleBuild(at)).toBe(true);
    expect(dispatches).toHaveLength(2);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(NOW + 31 * MINUTE));
  });

  test("blacklist add/remove are audited only when they change something", async () => {
    const { ctx } = await setup();
    const input = {
      type: "username",
      value: "Spammer",
      reason: "spam",
      actor,
    } satisfies Parameters<typeof addBlacklist>[1];
    expect(await addBlacklist(ctx, input)).toBe(true);
    expect(await addBlacklist(ctx, input)).toBe(false);
    expect(await getBlacklistEntry(db, "username", "spammer")).toBeDefined();
    expect(await removeBlacklist(ctx, input)).toBe(true);
    expect(await removeBlacklist(ctx, input)).toBe(false);
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "blacklist.add",
      "blacklist.remove",
    ]);
  });
});
