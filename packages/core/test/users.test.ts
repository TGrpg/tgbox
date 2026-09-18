import {
  advanceBroadcast,
  createBroadcast,
  messageUser,
  previewMessage,
  refreshUserAvatars,
  runDueBroadcasts,
  setBroadcastState,
  uploadMessageMedia,
} from "@tgbox/core";
import { getBotUserProfiles, getBroadcast, setBotUserAvatar, touchBotUser } from "@tgbox/db";
import type { OutgoingMessage } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { actor, auditRows, db, NOW, setup } from "./fake.ts";

const message: OutgoingMessage = {
  text: "新功能上线",
  format: "plain",
  media: null,
  buttons: [],
  buttonsPerRow: 1,
  silent: false,
  protect: false,
  noPreview: false,
};
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
      { ...message, text: "  " },
      { ...message, buttons: [{ text: "打开", url: "javascript:alert(1)" }] },
      { ...message, media: { type: "photo" as const, fileId: "f" }, text: "x".repeat(1025) },
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
    const button = {
      ...message,
      text: "你好",
      buttons: [{ text: "查看", url: "https://tgbox.cc/" }],
    };
    expect(await messageUser(ctx, { tgUserId: 7, message: button, actor })).toEqual({ ok: true });
    expect(telegram.at(-1)?.body).toMatchObject({
      chat_id: 7,
      reply_markup: { inline_keyboard: [[{ text: "查看", url: "https://tgbox.cc/" }]] },
    });
    telegramErrors.set(8, forbidden);
    expect(await messageUser(ctx, { tgUserId: 8, message, actor })).toMatchObject({
      ok: false,
      error: "blocked",
    });
    expect((await auditRows()).map((row) => row.action)).toEqual(["user.message"]);
    const next = await createBroadcast(ctx, { message, audience: "all", actor });
    expect(next).toMatchObject({ ok: true, broadcast: { total: 1 } });
  });
});

describe("rich messages", () => {
  test("a photo goes by file id with its caption, HTML, button rows and delivery flags", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:x" });
    await users(1);
    const rich: OutgoingMessage = {
      ...message,
      text: "<b>新功能</b>",
      format: "html",
      media: { type: "photo", fileId: "photo-id" },
      buttons: [
        { text: "A", url: "https://a.example" },
        { text: "B", url: "https://b.example" },
        { text: "C", url: "https://c.example" },
      ],
      buttonsPerRow: 2,
      silent: true,
      protect: true,
    };
    const created = await createBroadcast(ctx, { message: rich, audience: "all", actor });
    if (!created.ok) throw new Error(created.error);
    await advanceBroadcast(ctx, created.broadcast.id);
    expect(telegram.at(-1)).toEqual({
      method: "sendPhoto",
      body: {
        chat_id: 1,
        photo: "photo-id",
        caption: "<b>新功能</b>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "A", url: "https://a.example" },
              { text: "B", url: "https://b.example" },
            ],
            [{ text: "C", url: "https://c.example" }],
          ],
        },
        disable_notification: true,
        protect_content: true,
      },
    });
  });

  test("a scheduled broadcast waits for its start", async () => {
    const { ctx, telegram } = await setup({ BOT_TOKEN: "1:x" });
    await users(1);
    const created = await createBroadcast(ctx, {
      message,
      audience: "all",
      startAt: NOW + 60_000,
      actor,
    });
    if (!created.ok) throw new Error(created.error);
    await advanceBroadcast(ctx, created.broadcast.id);
    expect(recipients(telegram)).toEqual([]);
    await advanceBroadcast({ ...ctx, now: () => NOW + 60_000 }, created.broadcast.id);
    expect(recipients(telegram)).toEqual([1]);
  });

  test("a file is uploaded once to the previewing admin and comes back as a reusable id", async () => {
    const { ctx, telegram, telegramResults } = await setup({ BOT_TOKEN: "1:x" });
    telegramResults.set("sendDocument", {
      animation: { file_id: "gif-id" },
      document: { file_id: "doc-id" },
    });
    const uploaded = await uploadMessageMedia(ctx, {
      chatId: 900,
      type: "document",
      file: new Blob([new Uint8Array([1, 2, 3])]),
      filename: "a.gif",
      message: { ...message, text: "看这个" },
    });
    // Telegram filed the GIF as an animation, so that is what later sends use.
    expect(uploaded).toEqual({ ok: true, media: { type: "animation", fileId: "gif-id" } });
    expect(telegram.at(-1)).toMatchObject({
      method: "sendDocument",
      body: { chat_id: "900", document: "<file 3B>", caption: "看这个" },
    });
  });

  test("a preview reports Telegram's reason, e.g. broken HTML", async () => {
    const { ctx, telegramErrors } = await setup({ BOT_TOKEN: "1:x" });
    telegramErrors.set(900, {
      ok: false,
      error_code: 400,
      description: "Bad Request: can't parse entities",
    });
    expect(
      await previewMessage(ctx, {
        chatId: 900,
        message: { ...message, format: "html", text: "<b>" },
      }),
    ).toEqual({ ok: false, error: "failed", description: "Bad Request: can't parse entities" });
  });
});

describe("avatars", () => {
  const bucket = () => {
    const puts: string[] = [];
    const deletes: string[] = [];
    return {
      puts,
      deletes,
      media: {
        put: async (key: string) => {
          puts.push(key);
          return null;
        },
        delete: async (key: string | string[]) => {
          deletes.push(String(key));
        },
      } as unknown as import("@tgbox/core").AvatarBucket,
    };
  };

  test("the smallest photo is stored under a keyed hash, and replaced when the photo changes", async () => {
    const { ctx, telegramResults, telegramFiles } = await setup({ BOT_TOKEN: "1:x" });
    await users(7);
    telegramResults.set("getUserProfilePhotos", {
      photos: [
        [
          { file_id: "small", file_unique_id: "p1" },
          { file_id: "big", file_unique_id: "p1b" },
        ],
      ],
    });
    telegramResults.set("getFile", { file_path: "photos/1.jpg" });
    const store = bucket();
    await refreshUserAvatars(ctx, {
      users: [{ tgUserId: 7, avatarKey: null }],
      media: store.media,
      secret: "s",
    });
    const [first] = await getBotUserProfiles(db, [7]);
    expect(first?.avatarKey).toMatch(/^users\/[0-9a-f]{32}\.jpg$/);
    expect(store.puts).toEqual([first?.avatarKey]);
    expect(telegramFiles).toHaveLength(1);

    // Same photo a week later: nothing downloaded again.
    await refreshUserAvatars(ctx, {
      users: [{ tgUserId: 7, avatarKey: first?.avatarKey ?? null }],
      media: store.media,
      secret: "s",
    });
    expect(telegramFiles).toHaveLength(1);

    // A new photo gets a new key and the old object goes.
    telegramResults.set("getUserProfilePhotos", {
      photos: [[{ file_id: "new", file_unique_id: "p2" }]],
    });
    await refreshUserAvatars(ctx, {
      users: [{ tgUserId: 7, avatarKey: first?.avatarKey ?? null }],
      media: store.media,
      secret: "s",
    });
    const [second] = await getBotUserProfiles(db, [7]);
    expect(second?.avatarKey).not.toBe(first?.avatarKey);
    expect(store.deletes).toEqual([first?.avatarKey]);
  });

  test("a user without a photo is recorded as checked, with no key", async () => {
    const { ctx, telegramResults } = await setup({ BOT_TOKEN: "1:x" });
    await users(8);
    await setBotUserAvatar(db, { tgUserId: 8, avatarKey: "users/old.jpg", now: NOW - 1 });
    telegramResults.set("getUserProfilePhotos", { photos: [] });
    const store = bucket();
    await refreshUserAvatars(ctx, {
      users: [{ tgUserId: 8, avatarKey: "users/old.jpg" }],
      media: store.media,
      secret: "s",
    });
    expect(await getBotUserProfiles(db, [8])).toMatchObject([
      { avatarKey: null, avatarCheckedAt: NOW },
    ]);
    expect(store.deletes).toEqual(["users/old.jpg"]);
  });
});
