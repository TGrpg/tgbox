import { env } from "cloudflare:workers";
import { runRefresh } from "@tgbox/core";
import {
  createDb,
  getEntryByUsername,
  getSiteState,
  insertApprovedEntry,
  upsertSetting,
} from "@tgbox/db";
import { type EntryKind, type EntryStatus, PostView, settingsDefaults } from "@tgbox/shared";
import { beforeEach, describe, expect, test, vi } from "vitest";
import channelFirstPost from "../../../../packages/telegram/fixtures/channel-first-post.html?raw";
import channelPosts from "../../../../packages/telegram/fixtures/channel-posts.html?raw";
import profileBanned from "../../../../packages/telegram/fixtures/profile-banned.html?raw";
import profileChannel from "../../../../packages/telegram/fixtures/profile-channel.html?raw";
import profileGroup from "../../../../packages/telegram/fixtures/profile-group.html?raw";
import profileNotFound from "../../../../packages/telegram/fixtures/profile-not-found.html?raw";

const db = createDb(env.DB);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Midnight UTC: an even minute, and an even cycle while all entries fit one batch.
const T0 = Date.UTC(2026, 8, 17);
const CHANNEL_MEMBERS = 9_538_357;

type Behaviour = "channel" | "group" | "not_found" | "banned" | "rate_limited";

/** Fake t.me + Telegram CDN + Bot API, serving saved fixtures; `pages.posts` swaps the post feed. */
function fakeTelegram(site: Record<string, Behaviour>, pages: { posts?: string } = {}) {
  const calls: { url: string; body: string | null }[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url: input, body });
    const url = new URL(input);
    if (url.hostname === "api.telegram.org") return Response.json({ ok: true });
    if (url.hostname === "api.github.com") return new Response(null, { status: 204 });
    if (url.hostname.endsWith("telesco.pe")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    const [first, second, third] = url.pathname.split("/").filter(Boolean);
    const username = first === "s" ? second : first;
    const behaviour = username ? site[username] : undefined;
    if (!username || !behaviour) return new Response("not found", { status: 404 });
    if (behaviour === "rate_limited") return new Response("Too Many Requests", { status: 429 });
    if (first === "s")
      return new Response(third ? channelFirstPost : (pages.posts ?? channelPosts));
    const html = {
      channel: profileChannel,
      group: profileGroup,
      not_found: profileNotFound.replaceAll("zzqq_not_exist_987654", username),
      banned: profileBanned.replaceAll("qassambrigades", username),
    }[behaviour];
    return new Response(html);
  };
  const tme = (username: string) =>
    calls.filter((call) => new URL(call.url).pathname.split("/").includes(username));
  const dispatches = () => calls.filter((call) => call.url.startsWith("https://api.github.com/"));
  return { fetch, calls, tme, dispatches };
}

async function addEntry(
  username: string,
  options: { kind?: EntryKind; tier?: 0 | 1 | 2 | 3 | 4 | null } = {},
) {
  const { id } = await insertApprovedEntry(db, {
    entry: {
      username,
      kind: options.kind ?? "channel",
      categoryId: 1,
      title: username,
      listedAt: T0,
    },
    stats: { members: null, online: null, activityTier: options.tier ?? null, statsWrittenAt: T0 },
    tagIds: [],
    now: T0,
  });
  return id;
}

async function entry(username: string) {
  const row = await getEntryByUsername(db, username);
  if (!row) throw new Error(`missing ${username}`);
  return row;
}

async function statsOf(id: number) {
  return env.DB.prepare("SELECT * FROM entry_stats WHERE entry_id = ?").bind(id).first();
}

async function r2Snapshot() {
  const listed = await env.MEDIA.list();
  return listed.objects.map((object) => `${object.key}:${object.etag}`).sort();
}

const setStatus = (id: number, status: EntryStatus) =>
  env.DB.prepare("UPDATE entries SET status = ? WHERE id = ?").bind(status, id).run();

const adminEnv = { ...env, ADMIN_CHAT_ID: "-100123" };

beforeEach(async () => {
  await env.DB.batch(
    ["entries", "entry_stats", "entry_tags", "entries_fts", "site_state", "settings"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  const listed = await env.MEDIA.list();
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((object) => object.key));
});

describe("scheduling", () => {
  test("picks the id slice from the clock and writes nothing to schedule", async () => {
    for (const name of ["a1", "a2", "a3", "a4"]) await addEntry(name, { kind: "group" });
    const tg = fakeTelegram({ a1: "group", a2: "group", a3: "group", a4: "group" });
    const sliced = { ...env, REFRESH_BATCH_SIZE: "2" };

    const first = await runRefresh(sliced, T0, tg);
    expect(first.processed).toEqual(["a1", "a2"]);
    const second = await runRefresh(sliced, T0 + MINUTE, tg);
    expect(second.processed).toEqual(["a3", "a4"]);
    expect(await getSiteState(db, "refresh_cursor")).toBeUndefined();
  });

  test("skips removed and admin-hidden entries, and low-activity channels on odd cycles", async () => {
    await addEntry("quiet", { tier: 1 });
    await addEntry("busy", { tier: 3, kind: "group" });
    await setStatus(await addEntry("gone", { kind: "group" }), "removed");
    await setStatus(await addEntry("muted", { kind: "group" }), "hidden_by_admin");
    const tg = fakeTelegram({ quiet: "channel", busy: "group", gone: "group", muted: "group" });

    const odd = await runRefresh(env, T0 + MINUTE, tg);
    expect(odd.processed).toEqual(["busy"]);
    const even = await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(even.processed).toEqual(["quiet", "busy"]);
  });
});

describe("writes only on change", () => {
  test("second refresh of an unchanged channel writes 0 rows and no R2 objects", async () => {
    const id = await addEntry("telegram");
    const tg = fakeTelegram({ telegram: "channel" });

    const first = await runRefresh(env, T0, tg);
    expect(first.rowsWritten).toBeGreaterThan(0);
    expect(first.dirty).toBe(true);
    const refreshed = await entry("telegram");
    expect(refreshed.title).toBe("Telegram News");
    expect(refreshed.avatarVersion).not.toBeNull();
    expect(refreshed.tgCreatedAt).not.toBeNull();
    expect(await statsOf(id)).toMatchObject({ members: CHANNEL_MEMBERS });
    const posts = await env.MEDIA.get("posts/telegram.json");
    expect(PostView.array().parse(await posts?.json()).length).toBeGreaterThan(0);
    expect(await env.MEDIA.head("avatars/telegram.jpg")).not.toBeNull();
    const history = await env.MEDIA.get("history/telegram.json");
    expect(await history?.json()).toEqual([
      { t: new Date(T0).toISOString(), members: CHANNEL_MEMBERS },
    ]);

    await env.DB.prepare("DELETE FROM site_state").run();
    const objects = await r2Snapshot();
    const second = await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(second.processed).toEqual(["telegram"]);
    expect(second.rowsWritten).toBe(0);
    expect(second.r2Writes).toBe(0);
    expect(second.dirty).toBe(false);
    expect(await r2Snapshot()).toEqual(objects);
    expect((await entry("telegram")).updatedAt).toBe(refreshed.updatedAt);
    expect(await getSiteState(db, "dirty_since")).toBeUndefined();
    // No t.me/s/{u}/1 once the creation date is known.
    expect(tg.calls.filter((call) => call.url.endsWith("/1"))).toHaveLength(1);
  });

  test("stats are written on a ≥1% member change or when a week old, not for small drifts", async () => {
    const id = await addEntry("telegram");
    const tg = fakeTelegram({ telegram: "channel" });
    await runRefresh(env, T0, tg);
    const setMembers = (members: number, writtenAt: number) =>
      env.DB.prepare("UPDATE entry_stats SET members = ?, stats_written_at = ? WHERE entry_id = ?")
        .bind(members, writtenAt, id)
        .run();

    await setMembers(CHANNEL_MEMBERS - 1_000, T0);
    await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(await statsOf(id)).toMatchObject({ members: CHANNEL_MEMBERS - 1_000 });

    await setMembers(CHANNEL_MEMBERS - 200_000, T0);
    await runRefresh(env, T0 + 4 * MINUTE, tg);
    expect(await statsOf(id)).toMatchObject({ members: CHANNEL_MEMBERS });

    const weekLater = T0 + 8 * DAY;
    await setMembers(CHANNEL_MEMBERS - 1_000, T0);
    await runRefresh(env, weekLater, tg);
    expect(await statsOf(id)).toMatchObject({
      members: CHANNEL_MEMBERS,
      stats_written_at: weekLater,
    });
    const history = await env.MEDIA.get("history/telegram.json");
    expect(await history?.json()).toHaveLength(2);
  });
});

describe("posts", () => {
  const viewsOnly = channelPosts.replace(/(tgme_widget_message_views">)[^<]*/g, "$11.99M");
  const newText = channelPosts.replace(/(tgme_widget_message_text[^>]*>)/, "$1Breaking: ");

  async function postsOf(username: string) {
    const object = await env.MEDIA.get(`posts/${username}.json`);
    return PostView.array().parse(await object?.json());
  }

  test("a views-only change is not a change within 24h", async () => {
    await addEntry("telegram");
    const pages: { posts?: string } = {};
    const tg = fakeTelegram({ telegram: "channel" }, pages);
    await runRefresh(env, T0, tg);
    const before = await postsOf("telegram");

    pages.posts = viewsOnly;
    const run = await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(run.r2Writes).toBe(0);
    expect(run.dirty).toBe(false);
    expect(await postsOf("telegram")).toEqual(before);
  });

  test("after 24h fresh view counts are written without marking the site dirty", async () => {
    await addEntry("telegram");
    const pages: { posts?: string } = {};
    const tg = fakeTelegram({ telegram: "channel" }, pages);
    await runRefresh(env, T0, tg);
    await env.DB.prepare("DELETE FROM site_state").run();

    pages.posts = viewsOnly;
    const run = await runRefresh(env, T0 + DAY, tg);
    expect(run.r2Writes).toBe(1);
    expect(run.dirty).toBe(false);
    expect(await getSiteState(db, "dirty_since")).toBeUndefined();
    expect((await postsOf("telegram")).every((post) => post.views === 1_990_000)).toBe(true);

    // Nothing new since that write: no rewrite.
    const again = await runRefresh(env, T0 + DAY + 2 * MINUTE, tg);
    expect(again.r2Writes).toBe(0);
  });

  test("a text change writes the posts and marks the site dirty", async () => {
    await addEntry("telegram");
    const pages: { posts?: string } = {};
    const tg = fakeTelegram({ telegram: "channel" }, pages);
    await runRefresh(env, T0, tg);
    await env.DB.prepare("DELETE FROM site_state").run();

    pages.posts = newText;
    const run = await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(run.r2Writes).toBe(1);
    expect(run.dirty).toBe(true);
    expect(await getSiteState(db, "dirty_since")).toBe(String(T0 + 2 * MINUTE));
    expect((await postsOf("telegram")).some((post) => post.text.startsWith("Breaking: "))).toBe(
      true,
    );
  });
});

describe("build dispatch", () => {
  const prefixed = (prefix: string) =>
    channelPosts.replace(/(tgme_widget_message_text[^>]*>)/, `$1${prefix}: `);

  /** What the build workflow does when it finishes: the flag is cleared, the timestamp stays. */
  const buildFinished = () =>
    env.DB.prepare("DELETE FROM site_state WHERE key = ?").bind("dirty_since").run();

  test("a change found by the cron dispatches a build, then at most one every 30 minutes", async () => {
    await addEntry("telegram");
    const pages: { posts?: string } = {};
    const tg = fakeTelegram({ telegram: "channel" }, pages);

    // First listing refresh: everything is new, so the site is dirty and a build goes out.
    const first = await runRefresh(env, T0, tg);
    expect(first.dirty).toBe(true);
    expect(tg.dispatches()).toHaveLength(1);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(T0));

    // `dirty_since` is still set (the build has not finished), but a fresh change soon after
    // must not dispatch again.
    pages.posts = prefixed("Breaking");
    const soon = await runRefresh(env, T0 + 6 * MINUTE, tg);
    expect(soon.dirty).toBe(true);
    expect(tg.dispatches()).toHaveLength(1);

    pages.posts = prefixed("Later");
    const later = await runRefresh(env, T0 + 32 * MINUTE, tg);
    expect(later.dirty).toBe(true);
    expect(tg.dispatches()).toHaveLength(2);
    expect(await getSiteState(db, "build_dispatched_at")).toBe(String(T0 + 32 * MINUTE));
    expect(later.subrequests).toBeLessThanOrEqual(50);
  });

  test("the throttle also holds for the first change after a build cleared the flag", async () => {
    await addEntry("telegram");
    const pages: { posts?: string } = {};
    const tg = fakeTelegram({ telegram: "channel" }, pages);
    await runRefresh(env, T0, tg);
    expect(tg.dispatches()).toHaveLength(1);
    // That build ran and cleared `dirty_since`, so the next change is a fresh transition —
    // which used to dispatch immediately, giving a build every few minutes.
    await buildFinished();

    pages.posts = prefixed("Two");
    await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(await getSiteState(db, "dirty_since")).toBe(String(T0 + 2 * MINUTE));
    expect(tg.dispatches()).toHaveLength(1);

    pages.posts = prefixed("Twenty");
    await runRefresh(env, T0 + 20 * MINUTE, tg);
    expect(tg.dispatches()).toHaveLength(1);

    pages.posts = prefixed("ThirtyOne");
    await runRefresh(env, T0 + 31 * MINUTE, tg);
    expect(tg.dispatches()).toHaveLength(2);
    // The change from minute 2 was never lost: the flag stayed set until this build.
    expect(await getSiteState(db, "dirty_since")).toBe(String(T0 + 2 * MINUTE));
  });

  test("a refresh that changes nothing dispatches nothing", async () => {
    await addEntry("telegram");
    const tg = fakeTelegram({ telegram: "channel" });
    await runRefresh(env, T0, tg);
    await env.DB.prepare("DELETE FROM site_state").run();

    const second = await runRefresh(env, T0 + 2 * MINUTE, tg);
    expect(second.dirty).toBe(false);
    expect(tg.dispatches()).toHaveLength(1);
    expect(await getSiteState(db, "build_dispatched_at")).toBeUndefined();
  });

  test("without a GitHub repo the refresh still marks dirty", async () => {
    await addEntry("telegram");
    const tg = fakeTelegram({ telegram: "channel" });
    const run = await runRefresh({ ...env, GITHUB_REPO: "" }, T0, tg);
    expect(run.dirty).toBe(true);
    expect(tg.dispatches()).toEqual([]);
    expect(await getSiteState(db, "dirty_since")).toBe(String(T0));
    expect(await getSiteState(db, "build_dispatched_at")).toBeUndefined();
  });
});

describe("liveness", () => {
  test("not_found hides only after 3 checks spanning 48h, then restores when active", async () => {
    await addEntry("vanished", { kind: "group" });
    const site: Record<string, Behaviour> = { vanished: "not_found" };
    const tg = fakeTelegram(site);

    for (const at of [T0, T0 + HOUR, T0 + 2 * HOUR]) await runRefresh(adminEnv, at, tg);
    expect(await entry("vanished")).toMatchObject({ status: "approved", failCount: 3 });

    const hidden = await runRefresh(adminEnv, T0 + 48 * HOUR, tg);
    expect(hidden.hidden).toEqual(["vanished"]);
    expect(await entry("vanished")).toMatchObject({ status: "hidden_by_system", failCount: 4 });
    expect(await getSiteState(db, "dirty_since")).toBe(String(T0 + 48 * HOUR));

    site.vanished = "group";
    const restored = await runRefresh(adminEnv, T0 + 50 * HOUR, tg);
    expect(restored.restored).toEqual(["vanished"]);
    expect(await entry("vanished")).toMatchObject({
      status: "approved",
      liveness: "active",
      failCount: 0,
      firstFailAt: null,
    });
  });

  test("banned hides after 2 checks and admins get one summary message", async () => {
    await addEntry("blocked", { kind: "group" });
    const tg = fakeTelegram({ blocked: "banned" });

    await runRefresh(adminEnv, T0, tg);
    expect(await entry("blocked")).toMatchObject({ status: "approved", failCount: 1 });
    await runRefresh(adminEnv, T0 + 2 * MINUTE, tg);
    expect(await entry("blocked")).toMatchObject({ status: "hidden_by_system" });

    const sent = tg.calls.filter((call) => call.url.includes("api.telegram.org"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({ chat_id: "-100123" });
    expect(sent[0]?.body).toContain("@blocked");
  });

  test("the hidden-entry summary goes to the review chat from the settings when set", async () => {
    await upsertSetting(
      db,
      "bot",
      JSON.stringify({ ...settingsDefaults.bot, reviewChatId: "-100777" }),
      T0,
    );
    await addEntry("blocked", { kind: "group" });
    const tg = fakeTelegram({ blocked: "banned" });
    await runRefresh(adminEnv, T0, tg);
    await runRefresh(adminEnv, T0 + 2 * MINUTE, tg);

    const sent = tg.calls.filter((call) => call.url.includes("api.telegram.org"));
    expect(sent.map((call) => JSON.parse(call.body ?? "{}").chat_id)).toEqual(["-100777"]);
  });

  test("in admins review mode the hidden-entry summary is a private copy to each admin", async () => {
    await upsertSetting(
      db,
      "bot",
      JSON.stringify({ ...settingsDefaults.bot, reviewMode: "admins", extraAdminIds: ["902"] }),
      T0,
    );
    await addEntry("blocked", { kind: "group" });
    const tg = fakeTelegram({ blocked: "banned" });
    const env2 = { ...adminEnv, ADMIN_IDS: "900,901" };
    await runRefresh(env2, T0, tg);
    const run = await runRefresh(env2, T0 + 2 * MINUTE, tg);

    const sent = tg.calls.filter((call) => call.url.includes("api.telegram.org"));
    expect(sent.map((call) => JSON.parse(call.body ?? "{}").chat_id)).toEqual([
      "900",
      "901",
      "902",
    ]);
    expect(run.subrequests).toBeLessThanOrEqual(50);
  });

  test("guard: with 2+ definitive failures in one batch, failures are counted but nothing is hidden", async () => {
    await addEntry("b1", { kind: "group" });
    await addEntry("b2", { kind: "group" });
    const tg = fakeTelegram({ b1: "banned", b2: "banned" });

    await runRefresh(adminEnv, T0, tg);
    const run = await runRefresh(adminEnv, T0 + 2 * MINUTE, tg);
    expect(run.hidden).toEqual([]);
    expect(await entry("b1")).toMatchObject({ status: "approved", failCount: 2 });
    expect(await entry("b2")).toMatchObject({ status: "approved", failCount: 2 });
    expect(tg.calls.some((call) => call.url.includes("api.telegram.org"))).toBe(false);
  });

  test("a 429 is unknown: no failure recorded and the rest of the batch is deferred", async () => {
    await addEntry("limited", { kind: "group" });
    await addEntry("later", { kind: "group" });
    const tg = fakeTelegram({ limited: "rate_limited", later: "group" });

    const run = await runRefresh(env, T0, tg);
    expect(run.rowsWritten).toBe(0);
    expect(run.deferred).toEqual(["later"]);
    expect(tg.tme("later")).toHaveLength(0);
    expect(await entry("limited")).toMatchObject({ failCount: 0, liveness: "active" });
  });
});

test("stays within the subrequest budget when every entry needs full writes", async () => {
  const names = ["c1", "c2", "c3", "c4", "c5", "c6"];
  for (const name of names) await addEntry(name);
  const tg = fakeTelegram(Object.fromEntries(names.map((name) => [name, "channel" as const])));

  const run = await runRefresh(env, T0, tg);
  expect(run.subrequests).toBeLessThanOrEqual(45);
  expect(run.processed.length).toBeGreaterThan(0);
  expect(run.deferred.length).toBeGreaterThan(0);
  expect([...run.processed, ...run.deferred]).toEqual(names);
  for (const name of run.deferred) expect(tg.tme(name)).toHaveLength(0);
});

test("the cron's default fetch is called the way the Workers runtime requires", async () => {
  await addEntry("default_fetch", { kind: "group" });
  const tg = fakeTelegram({ default_fetch: "group" });
  // workerd rejects a detached fetch invoked as a method of another object ("Illegal invocation").
  vi.stubGlobal("fetch", function (this: unknown, input: string, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return tg.fetch(input, init);
  });
  try {
    const run = await runRefresh(env, T0);
    expect(run.processed).toEqual(["default_fetch"]);
    expect(await entry("default_fetch")).toMatchObject({ liveness: "active" });
    expect(await statsOf((await entry("default_fetch")).id)).toMatchObject({ members: 1874 });
  } finally {
    vi.unstubAllGlobals();
  }
});
