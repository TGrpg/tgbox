import { upsertBotChat } from "@tgbox/db";
import { Composer, type Context } from "grammy";
import type { App } from "./app.ts";

/** Remembers the groups and channels the bot is in, so the admin can pick review/publish chats. */
export function chatMembers(app: App) {
  const composer = new Composer<Context>();
  composer.on("my_chat_member", async (ctx) => {
    const { chat, new_chat_member: member } = ctx.myChatMember;
    // Private chats (users blocking the bot) are not selectable and would only cost writes.
    if (chat.type === "private") return;
    await upsertBotChat(app.db, {
      chatId: String(chat.id),
      type: chat.type,
      title: chat.title,
      username: "username" in chat && chat.username ? chat.username : null,
      status: member.status,
      updatedAt: app.now(),
    });
  });
  return composer;
}
