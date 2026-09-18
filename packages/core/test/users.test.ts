import {
  advanceBroadcast,
  createBroadcast,
  messageUser,
  runDueBroadcasts,
  setBroadcastState,
} from "@tgbox/core";
import { getBroadcast, touchBotUser } from "@tgbox/db";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const message = { text: "新功能上线", buttonText: null, buttonUrl: null };
const forbidden = {
  ok: false,
  error_code: 403,
  description: "Forbidden: bot was blocked by the user",
};
const tooFast = { ok: false, error_code: 429, parameters: { retry_after: 3 } };

async function users(...ids: number[]) {
  for (const id of ids) {
    await touchBotUser(db, {
      tgUserId: id,
      firstName: `U${id}`,
      lastName: null,
      username: null,
      languageCode: "zh",
      now: NOW,
    });
  }
}

const recipients = (telegram: { method: string; body: unknown }[]) =>
  telegram
    .filter((call) => call.method === "sendMessage")
    .map((call) => (call.body as { chat_id: number }).chat_id);

describe("broadcasts", () => {
  test("one click reaches everyone once, batch by batch, and records who blocked the bot", async () => {
    const { ctx, telegram, telegramErrors } = await setup({ BOT_TOKEN: "1:x" });
    await users(1, 2, 3, 4, 5);
    telegramErrors.set(3, forbidden);
    const created = await createBroadcast(ctx, { message, audience: "all", actor });
    if (!created.ok) throw new Error(created.error);
    expect(created.broadcast.total).toBe(5);

    await advanceBroadcast(ctx, created.broadcast.id, 2);
    await advanceBroadcast(ctx, created.broadcast.id, 2);
    const after = await advanceBroadcast(ctx, created.broadcast.id, 2);
    expect(recipients(telegram)).toEqual([1, 2, 3, 4, 5]);
    expect(after).toMatchObject({ status: "done", sent: 4, blocked: 1, failed: 0 });
    // Nothing more once done.
    await advanceBroadcast(ctx, created.broadcast.id, 2);
    expect(recipients(telegram)).toHaveLength(5);

    // The blocked user is left out of the next broadcast.
    const next = await createBroadcast(ctx, { message, audience: "all", actor });
    expect(next).toMatchObject({ ok: true, broadcast: { total: 4 } });
  });

  test("a rate limit puts the rest back and waits out Telegram's back-off", async () => {
    const { ctx, telegram, telegramErrors } = await setup({ BOT_TOKEN: "1:x" });
    await users(1, 2, 3);
    telegramErrors.set(2, tooFast);
    const created = await createBroadcast(ctx, { message, audience: "all", actor });
    if (!created.ok) throw new Error(created.error);
    const held = await advanceBroadcast(ctx, created.broadcast.id);
    expect(held).toMatchObject({ status: "running", sent: 1, cursor: 1, notBefore: NOW + 3000 });
    // Still inside the back-off: nothing is sent.
    await advanceBroadcast(ctx, created.broadcast.id);
    expect(recipients(telegram)).toEqual([1, 2]);

    telegramErrors.clear();
    const later = { ...ctx, now: () => NOW + 3000 };
    const done = await advanceBroadcast(later, created.broadcast.id);
    expect(recipients(telegram)).toEqual([1, 2, 2, 3]);
    expect(done).toMatchObject({ status: "done", sent: 3 });
  });

  test("a paused broadcast sends nothing until resumed; a cancelled one never again", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:x" });
    await users(1, 2);
    const created = await createBroadcast(ctx, { message, audience: "all", actor });
    if (!created.ok) throw new Error(created.error);
    const { id } = created.broadcast;
    expect(await setBroadcastState(ctx, { id, action: "pause", actor })).toBe(true);
    await advanceBroadcast(ctx, id);
    expect(recipients(telegram)).toEqual([]);
    expect(await setBroadcastState(ctx, { id, action: "resume", actor })).toBe(true);
    expect(await setBroadcastState(ctx, { id, action: "cancel", actor })).toBe(true);
    expect(await setBroadcastState(ctx, { id, action: "resume", actor })).toBe(false);
    await advanceBroadcast(ctx, id);
    expect(recipients(telegram)).toEqual([]);
    expect((await auditRows()).map((row) => row.action)).toEqual([
      "broadcast.create",
      "broadcast.pause",
      "broadcast.resume",
      "broadcast.cancel",
    ]);
  });

  test("the cron advances due broadcasts within its subrequest budget", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:x" });
    await users(1, 2, 3, 4);
    const created = await createBroadcast(ctx, { message, audience: "all", actor });
    if (!created.ok) throw new Error(created.error);
    expect(await runDueBroadcasts(ctx, 3)).toBe(3);
    expect(recipients(telegram)).toEqual([1, 2, 3]);
    await runDueBroadcasts(ctx, 10);
    expect(await getBroadcast(db, created.broadcast.id)).toMatchObject({ status: "done", sent: 4 });
  });

  test("invalid messages and empty audiences are refused", async () => {
    const { ctx } = await setup({ BOT_TOKEN: "1:x" });
    await users(1);
    for (const bad of [
      { text: "  ", buttonText: null, buttonUrl: null },
      { text: "x", buttonText: "打开", buttonUrl: null },
      { text: "x", buttonText: "打开", buttonUrl: "javascript:alert(1)" },
    ]) {
      expect(await createBroadcast(ctx, { message: bad, audience: "all", actor })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(await createBroadcast(ctx, { message, audience: "paying", actor })).toEqual({
      ok: false,
      error: "empty",
    });
  });
});

describe("messaging one user", () => {
  test("sends with a button and audits; a 403 marks the user blocked", async () => {
    const { ctx, telegram, telegramErrors } = await setup({ BOT_TOKEN: "1:x" });
    await users(7, 8);
    const button = { text: "你好", buttonText: "查看", buttonUrl: "https://tgbox.cc/" };
    expect(await messageUser(ctx, { tgUserId: 7, message: button, actor })).toEqual({ ok: true });
    expect(telegram.at(-1)?.body).toMatchObject({
      chat_id: 7,
      reply_markup: { inline_keyboard: [[{ text: "查看", url: "https://tgbox.cc/" }]] },
    });
    telegramErrors.set(8, forbidden);
    expect(await messageUser(ctx, { tgUserId: 8, message, actor })).toEqual({
      ok: false,
      error: "blocked",
    });
    expect((await auditRows()).map((row) => row.action)).toEqual(["user.message"]);
    const next = await createBroadcast(ctx, { message, audience: "all", actor });
    expect(next).toMatchObject({ ok: true, broadcast: { total: 1 } });
  });
});
