import { background, type CoreContext, getSettings } from "@tgbox/core";
import { createDb, type Db } from "@tgbox/db";
import { type ReviewMode, reviewRecipients, type Settings } from "@tgbox/shared";
import { type EntrySnapshot, fetchEntrySnapshot, type SnapshotOptions } from "@tgbox/telegram";
import { Api, type Context } from "grammy";
import type { Message } from "grammy/types";

export type BotEnv = Env & {
  /** Public bot username (without @); used to match `/command@bot` in groups. */
  BOT_USERNAME?: string;
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
  /** Bot API client for work outside an update (Crypto Pay webhook, cron). */
  api: Api;
  fetch: typeof fetch;
  now: () => number;
  background: (task: () => Promise<unknown>) => Promise<void>;
  /** Admin settings, read at most once per update. */
  settings: () => Promise<Settings>;
  /**
   * Sends a review message to the review chat, or a private copy to each admin (settings
   * `reviewMode`, or no review chat configured). Failed copies are logged; returns the sent ones.
   */
  sendReview: (
    text: string,
    options?: Parameters<Api["sendMessage"]>[2],
  ) => Promise<{ mode: ReviewMode; sent: Message.TextMessage[] }>;
  /** env ADMIN_IDS (super admins) ∪ settings extraAdminIds */
  isAdmin: (ctx: Context) => Promise<boolean>;
  snapshot: (
    username: string,
    options: Pick<SnapshotOptions, "knownKind" | "needCreatedAt">,
  ) => Promise<EntrySnapshot>;
};

export function createApp(env: BotEnv, deps: BotDeps): App {
  const db = createDb(env.DB);
  const now = deps.now ?? Date.now;
  const superAdminIds = new Set(
    (env.ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );

  const core: CoreContext = {
    db,
    fetch: deps.fetch,
    now,
    config: {
      GITHUB_REPO: env.GITHUB_REPO,
      GITHUB_DISPATCH_TOKEN: env.GITHUB_DISPATCH_TOKEN,
      BOT_TOKEN: env.BOT_TOKEN,
      SITE_URL: env.SITE_URL,
      SETTINGS_KEY: env.SETTINGS_KEY,
    },
    waitUntil: deps.waitUntil,
  };

  // The app is created per request, so this memo lives for one update only.
  let loaded: Promise<Settings> | undefined;
  const settings = () => {
    loaded ??= getSettings(core);
    return loaded;
  };

  const api = new Api(env.BOT_TOKEN, { fetch: deps.fetch });

  return {
    env,
    db,
    core,
    api,
    fetch: deps.fetch,
    now,
    background: (task) => background(core, task),
    settings,
    sendReview: async (text, options) => {
      const { mode, chatIds } = reviewRecipients((await settings()).bot, env);
      const results = await Promise.allSettled(
        chatIds.map((chatId) => api.sendMessage(chatId, text, options)),
      );
      const sent: Message.TextMessage[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") sent.push(result.value);
        else console.error("review message failed", chatIds[index], result.reason);
      });
      if (chatIds.length === 0) console.error("no review chat or admins configured");
      return { mode, sent };
    },
    isAdmin: async (ctx) => {
      if (ctx.from === undefined) return false;
      const id = String(ctx.from.id);
      // Super admins skip the settings read.
      return superAdminIds.has(id) || (await settings()).bot.extraAdminIds.includes(id);
    },
    snapshot: (username, options) =>
      fetchEntrySnapshot(username, { ...options, fetch: deps.fetch, now: new Date(now()) }),
  };
}
