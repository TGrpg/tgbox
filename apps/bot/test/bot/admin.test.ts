import {
  getBlacklistEntry,
  getEntryByUsername,
  getEntryTagIds,
  getSiteState,
  insertApprovedEntry,
  listCategories,
  listTags,
} from "@tgbox/db";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, db, type Harness, startHarness } from "./harness.ts";

let h: Harness;
const stranger = { id: 1, is_bot: false, first_name: "Eve" };

beforeEach(async () => {
  h = await startHarness();
  const now = Date.now();
  await insertApprovedEntry(db, {
    entry: {
      username: "managed",
      kind: "channel",
      categoryId: 1,
      title: "Managed Channel",
      listedAt: now,
    },
    stats: { members: 1234, online: null, activityTier: 2, statsWrittenAt: now },
    tagIds: [],
    now,
  });
});

const reply = () => h.calls("sendMessage").at(-1)?.payload.text;

describe("admin commands", () => {
  test("/ban and /unban by user id and by username", async () => {
    await h.message(ADMIN, "/ban 777 spam bot");
    expect(await getBlacklistEntry(db, "user", "777")).toMatchObject({ reason: "spam bot" });
    await h.message(ADMIN, "/ban @Spammy_Channel");
    expect(await getBlacklistEntry(db, "username", "spammy_channel")).toBeDefined();

    await h.message(ADMIN, "/unban 777");
    expect(await getBlacklistEntry(db, "user", "777")).toBeUndefined();
    await h.message(ADMIN, "/unban https://t.me/spammy_channel");
    expect(await getBlacklistEntry(db, "username", "spammy_channel")).toBeUndefined();
    expect(reply()).toContain("已解除拉黑");
  });

  test.each([
    ["/hide @managed", "hidden_by_admin"],
    ["/remove @managed", "removed"],
  ])("%s changes the status and marks the site dirty", async (command, status) => {
    await h.message(ADMIN, command);
    expect(await getEntryByUsername(db, "managed")).toMatchObject({ status });
    expect(await getSiteState(db, "dirty_since")).toBeDefined();
    expect(h.dispatches).toHaveLength(1);
  });

  test("/unhide restores a hidden entry", async () => {
    await h.message(ADMIN, "/hide @managed");
    await h.message(ADMIN, "/unhide @managed");
    expect(await getEntryByUsername(db, "managed")).toMatchObject({ status: "approved" });
  });

  test("/setcat moves the entry to a category of its kind", async () => {
    await h.message(ADMIN, "/setcat @managed tech");
    const tech = (await listCategories(db)).find((c) => c.kind === "channel" && c.slug === "tech");
    expect(await getEntryByUsername(db, "managed")).toMatchObject({ categoryId: tech?.id });

    await h.message(ADMIN, "/setcat @managed vps");
    expect(reply()).toContain("不存在");
  });

  test("/settags replaces the tags and makes them searchable", async () => {
    await h.message(ADMIN, "/settags @managed free, open-source");
    const entry = await getEntryByUsername(db, "managed");
    const expected = (await listTags(db))
      .filter((t) => ["free", "open-source"].includes(t.slug))
      .map((t) => t.id);
    expect((await getEntryTagIds(db, entry?.id ?? 0)).sort()).toEqual(expected.sort());
    expect(h.dispatches).toHaveLength(1);

    await h.message(ADMIN, "/settags @managed nonsense");
    expect(reply()).toContain("nonsense");
  });

  test("/status reports status, liveness and stats", async () => {
    await h.message(ADMIN, "/status @managed");
    expect(reply()).toMatch(/approved[\s\S]*active[\s\S]*1234[\s\S]*news/);
  });

  test("commands work in the admin group with the bot mention", async () => {
    await h.message(ADMIN, "/hide@tgboxccbot @managed", {
      id: -100500,
      type: "supergroup",
      title: "Admins",
    });
    expect(await getEntryByUsername(db, "managed")).toMatchObject({ status: "hidden_by_admin" });
  });

  test("non-admins get no reaction and change nothing", async () => {
    await h.message(stranger, "/hide @managed");
    await h.message(stranger, "/ban 777");
    expect(h.telegram).toEqual([]);
    expect(await getEntryByUsername(db, "managed")).toMatchObject({ status: "approved" });
    expect(await getBlacklistEntry(db, "user", "777")).toBeUndefined();
  });
});
