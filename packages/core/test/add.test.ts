import { addBlacklist, previewEntry } from "@tgbox/core";
import { createSubmission, insertApprovedEntry } from "@tgbox/db";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

describe("previewing a manual listing", () => {
  test("fetches the t.me profile without writing anything", async () => {
    const { ctx, tme, dispatches } = await setup();

    const preview = await previewEntry(ctx, { username: "https://t.me/Some_Group" });
    expect(preview).toMatchObject({
      ok: true,
      username: "some_group",
      existing: null,
      pendingSubmissionId: null,
      blacklisted: false,
      snapshot: { liveness: "active", kind: "group" },
    });
    expect(tme.length).toBeGreaterThan(0);
    expect(dispatches).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  test("reports an already listed entry without fetching t.me", async () => {
    const { ctx, tme } = await setup();
    const { id } = await insertApprovedEntry(db, {
      entry: { username: "taken", kind: "channel", categoryId: 1, title: "Taken", listedAt: NOW },
      stats: { members: 1, online: null, activityTier: null, statsWrittenAt: NOW },
      tagIds: [],
      now: NOW,
    });

    expect(await previewEntry(ctx, { username: "@Taken" })).toMatchObject({
      ok: true,
      existing: { id, status: "approved", title: "Taken" },
      snapshot: null,
    });
    expect(tme).toEqual([]);
  });

  test("flags a pending submission and a blacklisted username", async () => {
    const { ctx } = await setup();
    const submissionId = await createSubmission(db, {
      tgUserId: 1,
      username: "some_channel",
      kind: "channel",
      categoryId: 1,
      tagIds: [],
      createdAt: NOW,
    });
    await addBlacklist(ctx, { type: "username", value: "some_channel", reason: null, actor });

    expect(await previewEntry(ctx, { username: "some_channel" })).toMatchObject({
      ok: true,
      pendingSubmissionId: submissionId,
      blacklisted: true,
      snapshot: { liveness: "active", kind: "channel" },
    });
  });

  test.each([
    ["not a link!", { ok: false, error: "invalid_username" }],
    ["gone_away", { ok: true, snapshot: { liveness: "not_found" } }],
    ["some_user", { ok: true, snapshot: { kind: "user" } }],
  ])("%s", async (username, expected) => {
    const { ctx } = await setup();
    expect(await previewEntry(ctx, { username })).toMatchObject(expected);
  });
});
