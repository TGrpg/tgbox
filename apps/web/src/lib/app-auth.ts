import { env } from "cloudflare:workers";
import type { CoreContext } from "@tgbox/core";
import { createDb, type Db, getBlacklistEntry } from "@tgbox/db";
import { type InitDataUser, verifyInitData } from "@tgbox/telegram";

/**
 * Authentication for `/api/app/*`, the Telegram Mini App's only Worker surface.
 *
 * SECURITY BOUNDARY. The credential is the Mini App launch string (`initData`): Telegram signs it
 * with the bot token, and we accept it for 24 hours, which means it is **replayable for a day** by
 * anyone who gets hold of it. That is acceptable here for exactly one reason — this token grants
 * access to the caller's *own* data and nothing else: their submissions, their orders, their
 * language. It carries no admin capability whatsoever (the admin panel checks an allow-list on top
 * of the same signature; this endpoint family must never grow one).
 *
 * The consequence for every handler: **take the user id from `session.user.id`, never from the
 * request body or a query parameter.** A body is attacker-controlled even when the signature is
 * valid, so a handler that trusts one turns a self-service API into an impersonation API.
 */
export type AppSession = {
  user: InitDataUser;
  db: Db;
  /** Context for `@tgbox/core` operations, so business rules stay shared with the bot. */
  core: CoreContext;
};

export type AppAuthResult = { ok: true; session: AppSession } | { ok: false; response: Response };

const deny = (error: "unauthorized" | "banned", status: number): AppAuthResult => ({
  ok: false,
  response: Response.json({ error }, { status, headers: { "cache-control": "no-store" } }),
});

/**
 * Verifies `X-Telegram-Init-Data` and returns the caller. Unlike the admin panel this is **not** an
 * allow-list: every real Telegram user is welcome. The only rejection is the blacklist, the same
 * check the bot's guard makes before answering a private message.
 */
export async function authenticateApp(request: Request, now = Date.now()): Promise<AppAuthResult> {
  const initData = request.headers.get("X-Telegram-Init-Data");
  if (!initData) return deny("unauthorized", 401);

  const user = await verifyInitData(initData, env.BOT_TOKEN, now);
  if (!user) return deny("unauthorized", 401);

  const db = createDb(env.DB);
  if (await getBlacklistEntry(db, "user", String(user.id))) return deny("banned", 403);

  return { ok: true, session: { user, db, core: appCore(db, now) } };
}

/**
 * The core runtime for a Mini App request. Build dispatch is deliberately unconfigured: nothing a
 * user does here changes the public site, so the web Worker never asks GitHub for a build.
 */
function appCore(db: Db, now: number): CoreContext {
  return {
    db,
    fetch: (input, init) => fetch(input, init),
    // Frozen for the request, so every check inside one request sees the same clock.
    now: () => now,
    config: {
      GITHUB_REPO: "",
      GITHUB_DISPATCH_TOKEN: "",
      BOT_TOKEN: env.BOT_TOKEN,
      // Only so a Mini App submission can tell the reviewers it exists. These are Telegram ids,
      // not capabilities — anyone holding BOT_TOKEN can already message any chat.
      ADMIN_IDS: env.ADMIN_IDS,
      ADMIN_CHAT_ID: env.ADMIN_CHAT_ID,
    },
  };
}

/** `{ ok: false, error }`, the shape every endpoint in the contract uses for a refusal. */
export const appError = (error: string, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });

/** A Mini App answer is always about one user right now: never cache it anywhere. */
export const appJson = (body: unknown) =>
  Response.json(body, { headers: { "cache-control": "no-store" } });

/** Parsed JSON body, or undefined when the request carried something else. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
