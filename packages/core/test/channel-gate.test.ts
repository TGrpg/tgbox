import { checkSubmission, updateSettings } from "@tgbox/core";
import { upsertSetting } from "@tgbox/db";
import { settingsDefaults } from "@tgbox/shared";
import { expect, test } from "vitest";
import { actor, db, NOW, setup } from "./fake.ts";

const gated = { ...settingsDefaults.site, officialChannel: "tgboxcc", followToSubmit: true };
const { friendLinks: _, featured: __, ...siteForm } = gated;

async function gate(status: unknown) {
  const fake = await setup({ BOT_TOKEN: "123:bot" });
  await upsertSetting(db, "site", JSON.stringify(gated), NOW);
  fake.telegramResults.set("getChatMember", status);
  return fake;
}

test("a submitter outside the official channel is asked to join it", async () => {
  const { ctx, telegram } = await gate({ status: "left" });
  expect(await checkSubmission(ctx, { tgUserId: 42, username: "some_channel" })).toEqual({
    ok: false,
    error: "not_following",
    channel: "tgboxcc",
  });
  expect(telegram).toEqual([
    { method: "getChatMember", body: { chat_id: "@tgboxcc", user_id: 42 } },
  ]);
});

test.each([
  ["member", { status: "member" }],
  ["restricted but still in it", { status: "restricted", is_member: true }],
  // The bot lost its admin rights: let people through rather than close submissions.
  ["unknown to Telegram", true],
])("a submitter who is %s may submit", async (_label, status) => {
  const { ctx } = await gate(status);
  expect(await checkSubmission(ctx, { tgUserId: 42, username: "some_channel" })).toMatchObject({
    ok: true,
  });
});

test("no Bot API call when the gate is off", async () => {
  const { ctx, telegram } = await setup({ BOT_TOKEN: "123:bot" });
  await upsertSetting(db, "site", JSON.stringify({ ...gated, followToSubmit: false }), NOW);
  expect(await checkSubmission(ctx, { tgUserId: 42, username: "some_channel" })).toMatchObject({
    ok: true,
  });
  expect(telegram).toEqual([]);
});

test("the gate can only be switched on once the bot admins the channel", async () => {
  const { ctx, telegram, telegramResults } = await setup({ BOT_TOKEN: "123:bot" });
  telegramResults.set("getChatMember", { status: "member" });
  expect(await updateSettings(ctx, { key: "site", value: siteForm, actor })).toEqual({
    ok: false,
    error: "bot_not_channel_admin",
  });
  // The bot asks about itself: its id is the token's prefix.
  expect(telegram[0]?.body).toEqual({ chat_id: "@tgboxcc", user_id: 123 });

  telegramResults.set("getChatMember", { status: "administrator" });
  expect(await updateSettings(ctx, { key: "site", value: siteForm, actor })).toEqual({
    ok: true,
    changed: true,
  });
  expect(
    await updateSettings(ctx, {
      key: "site",
      value: { ...siteForm, officialChannel: null },
      actor,
    }),
  ).toEqual({ ok: false, error: "invalid" });
});
