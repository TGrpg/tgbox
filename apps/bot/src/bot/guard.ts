import { getBlacklistEntry } from "@tgbox/db";
import { Composer, type Context } from "grammy";
import type { App } from "./app.ts";

/** Blacklisted users get no response at all in private chats (the submit flow). */
export function guard(app: App) {
  const composer = new Composer<Context>();
  composer.chatType("private").use(async (ctx, next) => {
    if (await getBlacklistEntry(app.db, "user", String(ctx.from.id))) return;
    await next();
  });
  return composer;
}
