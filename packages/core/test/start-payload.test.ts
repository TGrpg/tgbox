import { approveSubmissions, submitEntry } from "@tgbox/core";
import { getEntryByUsername, getSubmission, listCategories, upsertSetting } from "@tgbox/db";
import { settingsDefaults, telegramLinks } from "@tgbox/shared";
import { expect, test } from "vitest";
import { actor, db, NOW, setup } from "./fake.ts";

test("a reviewed bot payload survives submission, notification, approval and publication", async () => {
  const { ctx, telegram } = await setup({
    BOT_TOKEN: "1:test",
    ADMIN_CHAT_ID: "900",
    SITE_URL: "https://tgbox.test",
  });
  await upsertSetting(
    db,
    "bot",
    JSON.stringify({ ...settingsDefaults.bot, publishChannelId: "-100999" }),
    NOW,
  );
  const category = (await listCategories(db)).find((row) => row.kind === "bot");
  if (!category) throw new Error("missing bot category");
  const result = await submitEntry(ctx, {
    tgUserId: 42,
    username: "https://t.me/some_bot?start=botlist",
    categoryId: category.id,
    tagIds: [],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(await getSubmission(db, result.submissionId)).toMatchObject({
    startPayload: "botlist",
    status: "pending",
  });
  expect(
    telegram.some((call) => JSON.stringify(call.body).includes("review before approval): botlist")),
  ).toBe(true);
  await approveSubmissions(ctx, { ids: [result.submissionId], actor });
  const entry = await getEntryByUsername(db, "some_bot");
  expect(entry?.startPayload).toBe("botlist");
  if (!entry) throw new Error("missing entry");
  expect(telegramLinks(entry).web).toBe("https://t.me/some_bot?start=botlist");
  expect(
    telegram.some((call) =>
      JSON.stringify(call.body).includes("https://t.me/some_bot?start=botlist"),
    ),
  ).toBe(true);
});

test("invalid payload is refused before profile fetch or persistence; non-bot payload is discarded", async () => {
  const { ctx, tme } = await setup();
  const category = (await listCategories(db)).find((row) => row.kind === "channel");
  if (!category) throw new Error("missing category");
  const input = { tgUserId: 42, categoryId: category.id, tagIds: [] };
  expect(await submitEntry(ctx, { ...input, username: "t.me/some_bot?start=a&start=b" })).toEqual({
    ok: false,
    error: "invalid",
  });
  expect(tme).toEqual([]);
  const result = await submitEntry(ctx, { ...input, username: "t.me/some_channel?start=botlist" });
  if (!result.ok) throw new Error(result.error);
  expect(await getSubmission(db, result.submissionId)).toMatchObject({
    kind: "channel",
    startPayload: null,
  });
});

test("explicit core payload is validated and cannot contradict a tagged input", async () => {
  const { ctx, tme } = await setup();
  const category = (await listCategories(db)).find((row) => row.kind === "bot");
  if (!category) throw new Error("missing category");
  const input = { tgUserId: 42, categoryId: category.id, tagIds: [] };
  expect(
    await submitEntry(ctx, {
      ...input,
      username: "t.me/some_bot?start=first",
      startPayload: "second",
    }),
  ).toEqual({ ok: false, error: "invalid" });
  expect(
    await submitEntry(ctx, { ...input, username: "some_bot", startPayload: "invalid payload" }),
  ).toEqual({ ok: false, error: "invalid" });
  expect(tme).toEqual([]);
  const result = await submitEntry(ctx, {
    ...input,
    username: "some_bot",
    startPayload: "botlist",
  });
  if (!result.ok) throw new Error(result.error);
  expect((await getSubmission(db, result.submissionId))?.startPayload).toBe("botlist");
});
