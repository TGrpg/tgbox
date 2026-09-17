import type { Db } from "@tgbox/db";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Who performed an action: a Telegram admin (bot, Mini App) or a Cloudflare Access email. */
export type Actor = `tg:${number}` | `email:${string}`;

export const tgActor = (userId: number): Actor => `tg:${userId}`;
export const emailActor = (email: string): Actor => `email:${email.toLowerCase()}`;

/** Runtime shared by every operation. Built per request by the bot and the admin app. */
export type CoreContext = {
  db: Db;
  fetch: Fetch;
  now: () => number;
  config: {
    /** `owner/repo`; empty disables build dispatch (local dev). */
    GITHUB_REPO: string;
    GITHUB_DISPATCH_TOKEN: string;
  };
  /** `ctx.waitUntil` of the current request; without it background work is awaited inline. */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/** Runs non-critical work after the response when possible; failures are logged, never thrown. */
export async function background(ctx: CoreContext, task: () => Promise<unknown>) {
  const run = task().catch((error: unknown) => console.error("background task failed", error));
  if (ctx.waitUntil) ctx.waitUntil(run);
  else await run;
}
