import { background, type CoreContext } from "@tgbox/core";
import { createDb, type Db } from "@tgbox/db";
import { type EntrySnapshot, fetchEntrySnapshot, type SnapshotOptions } from "@tgbox/telegram";
import type { Context } from "grammy";

export type BotEnv = Env & {
  /** Public bot username (without @); used to match `/command@bot` in groups. */
  BOT_USERNAME?: string;
  SUBMIT_DAILY_LIMIT?: string;
};

export type BotDeps = {
  fetch: typeof fetch;
  /** `ctx.waitUntil` of the current request; without it background work is awaited inline. */
  waitUntil?: (promise: Promise<unknown>) => void;
  now?: () => number;
};

/** Per-update runtime shared by the feature composers. */
export type App = {
  env: BotEnv;
  db: Db;
  /** Context for `@tgbox/core` operations (shared with the admin app). */
  core: CoreContext;
  fetch: typeof fetch;
  now: () => number;
  background: (task: () => Promise<unknown>) => Promise<void>;
  isAdmin: (ctx: Context) => boolean;
  snapshot: (
    username: string,
    options: Pick<SnapshotOptions, "knownKind" | "needCreatedAt">,
  ) => Promise<EntrySnapshot>;
};

export function createApp(env: BotEnv, deps: BotDeps): App {
  const db = createDb(env.DB);
  const now = deps.now ?? Date.now;
  const adminIds = new Set(
    env.ADMIN_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );

  const core: CoreContext = {
    db,
    fetch: deps.fetch,
    now,
    config: { GITHUB_REPO: env.GITHUB_REPO, GITHUB_DISPATCH_TOKEN: env.GITHUB_DISPATCH_TOKEN },
    waitUntil: deps.waitUntil,
  };

  return {
    env,
    db,
    core,
    fetch: deps.fetch,
    now,
    background: (task) => background(core, task),
    isAdmin: (ctx) => ctx.from !== undefined && adminIds.has(String(ctx.from.id)),
    snapshot: (username, options) =>
      fetchEntrySnapshot(username, { ...options, fetch: deps.fetch, now: new Date(now()) }),
  };
}
