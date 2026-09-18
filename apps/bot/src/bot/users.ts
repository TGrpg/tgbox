import { touchBotUser } from "@tgbox/db";
import { Composer, type Context } from "grammy";
import type { App } from "./app.ts";

/**
 * Keeps the admin's user list: every private-chat update refreshes its sender. The upsert writes
 * nothing for a user already seen today with the same profile, and a failure never blocks the
 * update itself. Groups, channels and inline queries are not tracked.
 */
export function users(app: App) {
  const composer = new Composer<Context>();
  composer.chatType("private").use(async (ctx, next) => {
    await touchBotUser(app.db, {
      tgUserId: ctx.from.id,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name ?? null,
      username: ctx.from.username ?? null,
      languageCode: ctx.from.language_code ?? null,
      now: app.core.now(),
    }).catch((error: unknown) => console.error("touch bot user failed", error));
    await next();
  });
  return composer;
}
