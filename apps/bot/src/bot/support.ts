import { addBlacklist, tgActor } from "@tgbox/core";
import {
  getSupportThread,
  getSupportThreadByTopic,
  touchSupportThread,
  upsertSupportThread,
} from "@tgbox/db";
import type { BotSettings } from "@tgbox/shared";
import { Composer, type Context, GrammyError } from "grammy";
import type { Message } from "grammy/types";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";

/** How stale a thread row may get before a relayed message refreshes it (1 write per hour, at most). */
const TOUCH_AFTER_MS = 60 * 60 * 1000;
/** Telegram's limit for a forum topic name. */
const TOPIC_NAME_MAX = 128;

/** The support group id, or null when the relay is off / not configured. */
export function supportGroupOf(bot: Pick<BotSettings, "supportEnabled" | "supportGroupId">) {
  return bot.supportEnabled ? bot.supportGroupId : null;
}

export const relayEnabled = (bot: Pick<BotSettings, "supportEnabled" | "supportGroupId">) =>
  supportGroupOf(bot) !== null;

// Staff copy is zh, like every other message the bot posts in an admin chat.
const staff = messages("zh").admin.support;

const displayName = (from: { first_name: string; last_name?: string }) =>
  [from.first_name, from.last_name].filter(Boolean).join(" ");

// Service messages (topic created/closed, joins, pins…) carry no copyable content.
const serviceFields = [
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "pinned_message",
  "message_auto_delete_timer_changed",
] as const;
const isServiceMessage = (message: Message) => serviceFields.some((field) => field in message);

const describe = (error: unknown) =>
  error instanceof GrammyError ? error.description : String(error);

const isTopicClosed = (error: unknown) =>
  error instanceof GrammyError && error.description.includes("TOPIC_CLOSED");

/**
 * User side: anything a user sends in private that no other flow consumed is copied into their
 * forum topic in the support group. Registered last, after `submit`.
 */
export function supportRelay(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  // One update is one message, so a failure is reported to the reviewers at most once.
  let reported = false;
  async function report(error: unknown) {
    console.error("support relay failed", error);
    if (reported) return;
    reported = true;
    await app.background(async () => {
      await app.sendReview(staff.relayFailed(describe(error)));
    });
  }

  composer.on("message", async (ctx) => {
    // Commands were already offered to every other composer; an unknown one is not a question.
    if (ctx.message.text?.startsWith("/")) return;
    const groupId = supportGroupOf((await app.settings()).bot);
    if (groupId === null) return;

    const userId = ctx.from.id;
    const existing = await getSupportThread(app.db, userId);
    const now = app.now();
    try {
      const topicId = existing ? existing.topicId : await openTopic(ctx, groupId, userId);
      await copyToTopic(ctx, groupId, topicId);
      if (existing) {
        await touchSupportThread(app.db, { tgUserId: userId, now, maxAgeMs: TOUCH_AFTER_MS });
      } else {
        // Only the first message of a session is acknowledged; a reply is coming from a human.
        await ctx.reply((await app.m(ctx)).supportChat.sent);
      }
    } catch (error) {
      await report(error);
      await ctx.reply((await app.m(ctx)).supportChat.unavailable).catch(() => {});
    }
  });

  /** Creates the user's topic, records it (1 write) and posts the header. */
  async function openTopic(ctx: Context, groupId: string, userId: number) {
    const from = ctx.from;
    if (!from) throw new Error("support relay: message without a sender");
    const name = staff.topicName(displayName(from), userId).slice(0, TOPIC_NAME_MAX);
    const { message_thread_id: topicId } = await ctx.api.createForumTopic(groupId, name);
    await upsertSupportThread(app.db, { tgUserId: userId, topicId, now: app.now() });
    await ctx.api.sendMessage(
      groupId,
      staff.header({
        id: userId,
        name: displayName(from),
        username: from.username ?? null,
        language: from.language_code ?? null,
      }),
      { message_thread_id: topicId },
    );
    return topicId;
  }

  /** A topic closed with /done reopens on the next message from the user. */
  async function copyToTopic(ctx: Context, groupId: string, topicId: number) {
    const copy = () =>
      ctx.api.copyMessage(groupId, ctx.chat?.id ?? 0, ctx.message?.message_id ?? 0, {
        message_thread_id: topicId,
      });
    try {
      await copy();
    } catch (error) {
      if (!isTopicClosed(error)) throw error;
      await ctx.api.reopenForumTopic(groupId, topicId);
      await copy();
    }
  }

  return root;
}

/**
 * Admin side: what support staff write inside a topic goes back to that topic's user.
 * Registered before `admin` so `/ban` inside a topic means "ban this user".
 */
export function supportGroup(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType(["group", "supergroup"]);

  composer.on("message", async (ctx, next) => {
    const topicId = ctx.message.message_thread_id;
    const groupId = supportGroupOf((await app.settings()).bot);
    // The General topic and every other group keep their normal admin behaviour.
    if (groupId === null || String(ctx.chat.id) !== groupId || topicId === undefined) return next();
    // The bot's own header and relayed copies must not bounce back.
    if (ctx.from.is_bot) return;
    if (isServiceMessage(ctx.message)) return;
    const thread = await getSupportThreadByTopic(app.db, topicId);
    if (!thread) return next();

    const inTopic = { message_thread_id: topicId };
    const command = /^\/(ban|done)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(ctx.message.text ?? "");
    if (command?.[1] === "ban") {
      const reason = command[2]?.trim() || null;
      await addBlacklist(app.core, {
        type: "user",
        value: String(thread.tgUserId),
        reason,
        actor: tgActor(ctx.from.id),
      });
      await ctx.reply(staff.banned(thread.tgUserId, reason), inTopic);
      return;
    }
    if (command?.[1] === "done") {
      // Confirm before closing: a closed topic rejects new messages. The row stays, so the next
      // message from the user reopens the topic instead of creating a second one.
      await ctx.reply(staff.done, inTopic);
      await ctx.api
        .closeForumTopic(ctx.chat.id, topicId)
        .catch((error: unknown) => console.error("closing support topic failed", error));
      return;
    }

    try {
      await ctx.api.copyMessage(thread.tgUserId, ctx.chat.id, ctx.message.message_id);
    } catch (error) {
      console.error("support reply failed", error);
      await ctx.reply(staff.relayFailed(describe(error)), inTopic).catch(() => {});
    }
  });

  return root;
}
