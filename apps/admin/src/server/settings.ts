import {
  type Actor,
  type CoreContext,
  getSettings,
  hasCredential,
  setCredential,
} from "@tgbox/core";
import { listBotChats } from "@tgbox/db";
import { BotSettings, MAX_POST_BLOCKLIST, PaymentSettings, SiteSettings } from "@tgbox/shared";
import { z } from "zod";

export type SettingsEnv = Pick<
  Env,
  "ADMIN_IDS" | "BOT_TOKEN" | "GITHUB_DISPATCH_TOKEN" | "SETTINGS_KEY" | "BOT_PUBLIC_URL"
>;

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Stricter than the stored contract: this is what an admin may save. */
export const SettingsInput = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("bot"),
    value: BotSettings.extend({
      extraAdminIds: z.array(z.string().regex(/^\d{1,20}$/)).max(50),
      submitDailyLimit: z.number().int().min(1).max(100),
      supportUsername: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/)
        .nullable(),
      supportGroupId: z
        .string()
        .regex(/^-?\d+$/)
        .nullable(),
      supportEnabled: z.boolean(),
      welcome: z.object({ zh: z.string().max(2000), en: z.string().max(2000) }),
    }),
  }),
  z.object({
    key: z.literal("site"),
    // Friend links have their own page and operations; a settings save keeps the stored list.
    value: SiteSettings.omit({ friendLinks: true }).extend({
      announcement: z
        .object({
          enabled: z.boolean(),
          zh: z.string().trim().max(200),
          en: z.string().trim().max(200),
          href: z.string().trim().max(300).refine(isHttpsUrl).nullable(),
        })
        .refine((a) => !a.enabled || (a.zh.length > 0 && a.en.length > 0), {
          message: "enabled announcement needs zh and en text",
        }),
      postBlocklist: z.array(z.string().trim().min(1).max(50)).max(MAX_POST_BLOCKLIST),
    }),
  }),
  z.object({ key: z.literal("payments"), value: PaymentSettings }),
]);
export type SettingsInput = z.infer<typeof SettingsInput>;

export const CryptoPayTokenInput = z.object({
  token: z.string().trim().min(10).max(200).regex(/^\S+$/),
});

const reviewStatuses = new Set(["member", "administrator"]);

/**
 * Everything the settings page shows. Secrets are reported as booleans only; the Crypto Pay token
 * and the TronGrid key are write-only (`hasCryptoPayToken`, `hasTronGridKey`).
 */
export async function loadSettingsView(core: CoreContext, env: SettingsEnv) {
  const [settings, botChats, hasCryptoPayToken, hasTronGridKey] = await Promise.all([
    getSettings(core),
    // Pickers, not a browsable list: the 100 most recently changed chats is every chat that
    // matters in practice, and it keeps the scan bounded.
    listBotChats(core.db, { page: 1, pageSize: 100 }),
    hasCredential(core, "cryptopay_token"),
    hasCredential(core, "trongrid_key"),
  ]);
  const chats = botChats.rows;
  const chatOption = ({ chatId, title, username }: (typeof chats)[number]) => ({
    chatId,
    title,
    username,
  });
  return {
    settings,
    // Groups the bot is in: the picker source for both the review chat and the support group.
    reviewChats: chats
      .filter(
        (chat) =>
          (chat.type === "group" || chat.type === "supergroup") && reviewStatuses.has(chat.status),
      )
      .map(chatOption),
    publishChannels: chats
      .filter((chat) => chat.type === "channel" && chat.status === "administrator")
      .map(chatOption),
    superAdminIds: (env.ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
    hasCryptoPayToken,
    hasTronGridKey,
    configured: {
      BOT_TOKEN: Boolean(env.BOT_TOKEN),
      GITHUB_DISPATCH_TOKEN: Boolean(env.GITHUB_DISPATCH_TOKEN),
      SETTINGS_KEY: Boolean(env.SETTINGS_KEY),
    },
    cryptoPayWebhookUrl: env.BOT_PUBLIC_URL
      ? `${env.BOT_PUBLIC_URL.replace(/\/+$/, "")}/cryptopay/webhook`
      : null,
  };
}

export type SettingsView = Awaited<ReturnType<typeof loadSettingsView>>;

/** Encrypts and stores the Crypto Pay token. The result never contains the token. */
export async function saveCryptoPayToken(
  core: CoreContext,
  input: { token: string; actor: Actor },
): Promise<{ ok: true } | { ok: false; error: "settings_key_missing" }> {
  if (!core.config.SETTINGS_KEY) return { ok: false, error: "settings_key_missing" };
  await setCredential(core, { key: "cryptopay_token", value: input.token, actor: input.actor });
  return { ok: true };
}

/**
 * Encrypts and stores the TronGrid API key. Optional — without it the watcher uses TronGrid's
 * free rate limit, which one query every five minutes is nowhere near.
 */
export async function saveTronGridKey(
  core: CoreContext,
  input: { token: string; actor: Actor },
): Promise<{ ok: true } | { ok: false; error: "settings_key_missing" }> {
  if (!core.config.SETTINGS_KEY) return { ok: false, error: "settings_key_missing" };
  await setCredential(core, { key: "trongrid_key", value: input.token, actor: input.actor });
  return { ok: true };
}
