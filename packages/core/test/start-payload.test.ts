import {
  approveSubmissions,
  checkSubmission,
  setEntryStartPayload,
  submitEntry,
} from "@tgbox/core";
import {
  entries,
  getEntryByUsername,
  getSiteState,
  getSubmission,
  listAuditLog,
  listCategories,
} from "@tgbox/db";
import { parseTelegramRef, telegramLinks } from "@tgbox/shared";
import { expect, test, vi } from "vitest";
import { actor, db, NOW, setup } from "./fake.ts";

async function seed(kind: "bot" | "channel" = "bot", startPayload: string | null = null) {
  const [entry] = await db
    .insert(entries)
    .values({
      username: "some_bot",
      kind,
      categoryId: 1,
      title: "Bot",
      listedAt: 1,
      updatedAt: 1,
      startPayload,
    })
    .returning();
  if (!entry) throw new Error("missing entry");
  return entry;
}

test.each([
  ["https://t.me/SomeBot?start=", "SomeBot"],
  ["https://t.me/SomeBot?start=ref_1", "SomeBot"],
  ["t.me/s/somechannel?start=x", "somechannel"],
  ["https://t.me/somechannel/123?start=x", "somechannel"],
])("submission ignores query in %s", async (username, parsed) => {
  const { ctx } = await setup();
  expect(parseTelegramRef(username)).toBe(parsed);
  expect(await checkSubmission(ctx, { tgUserId: 42, username })).toEqual({
    ok: true,
    username: parsed,
  });
  // The fixture for an unknown username is a channel profile.
  const category = (await listCategories(db)).find((row) => row.kind === "channel");
  if (!category) throw new Error("missing category");
  const result = await submitEntry(ctx, {
    tgUserId: 42,
    username,
    categoryId: category.id,
    tagIds: [],
  });
  if (!result.ok) throw new Error(result.error);
  const submission = await getSubmission(db, result.submissionId);
  expect(submission?.username).toBe(parsed.toLowerCase());
  expect(submission).not.toHaveProperty("startPayload");
  await approveSubmissions(ctx, { ids: [result.submissionId], actor });
  expect((await getEntryByUsername(db, parsed.toLowerCase()))?.startPayload).toBeNull();
});

test("bot approval never adopts a submitter's referral", async () => {
  const { ctx } = await setup();
  const category = (await listCategories(db)).find((row) => row.kind === "bot");
  if (!category) throw new Error("missing category");
  const result = await submitEntry(ctx, {
    tgUserId: 42,
    username: "t.me/some_bot?start=ref_1",
    categoryId: category.id,
    tagIds: [],
  });
  if (!result.ok) throw new Error(result.error);
  await approveSubmissions(ctx, { ids: [result.submissionId], actor });
  expect((await getEntryByUsername(db, "some_bot"))?.startPayload).toBeNull();
});

test("admin sets a payload, audits it and dispatches a dirty site", async () => {
  const { ctx, dispatches } = await setup();
  const entry = await seed();
  expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload: "Ref_1-x", actor })).toEqual(
    { ok: true, changed: true },
  );
  const saved = await getEntryByUsername(db, entry.username);
  expect(saved).toMatchObject({ startPayload: "Ref_1-x", updatedAt: NOW });
  expect(saved && telegramLinks(saved).web).toBe("https://t.me/some_bot?start=Ref_1-x");
  const { rows } = await listAuditLog(db, { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actor,
    action: "entry.start_payload",
    target: `entry:${entry.id}`,
    payload: { startPayload: "Ref_1-x" },
  });
  expect(await getSiteState(db, "dirty_since")).toBe(String(NOW));
  expect(dispatches).toHaveLength(1);
});

test.each([null, "", "  \t "])("admin clears with %j", async (startPayload) => {
  const { ctx } = await setup();
  const entry = await seed("bot", "old");
  expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload, actor })).toEqual({
    ok: true,
    changed: true,
  });
  expect((await getEntryByUsername(db, entry.username))?.startPayload).toBeNull();
  expect((await listAuditLog(db, { limit: 10 })).rows[0]?.payload).toEqual({ startPayload: null });
});

test.each([null, "same"])(
  "unchanged %j writes zero rows, no audit and no dispatch",
  async (startPayload) => {
    const { ctx, dispatches } = await setup();
    const entry = await seed("bot", startPayload);
    const run = vi.spyOn(Object.getPrototypeOf(db.$client.prepare("SELECT 1")), "run");
    expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload, actor })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await run.mock.results[0]?.value).toMatchObject({ meta: { rows_written: 0 } });
    run.mockRestore();
    expect((await getEntryByUsername(db, entry.username))?.updatedAt).toBe(1);
    expect((await listAuditLog(db, { limit: 10 })).rows).toEqual([]);
    expect(await getSiteState(db, "dirty_since")).toBeUndefined();
    expect(dispatches).toEqual([]);
  },
);

test.each(["bad value", "x".repeat(65), "a/b", "a\0b", " padded "])(
  "invalid %j is an error, never a write",
  async (startPayload) => {
    const { ctx, dispatches } = await setup();
    const entry = await seed();
    const update = vi.spyOn(db, "update");
    expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload, actor })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
    expect(dispatches).toEqual([]);
  },
);

test("missing entry and non-bot return errors; clearing a non-bot is allowed", async () => {
  const { ctx } = await setup();
  expect(await setEntryStartPayload(ctx, { id: 99999, startPayload: "ref", actor })).toEqual({
    ok: false,
    error: "not_found",
  });
  const entry = await seed("channel");
  expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload: "ref", actor })).toEqual({
    ok: false,
    error: "not_bot",
  });
  expect(await setEntryStartPayload(ctx, { id: entry.id, startPayload: " ", actor })).toEqual({
    ok: true,
    changed: false,
  });
});
