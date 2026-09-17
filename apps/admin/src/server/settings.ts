import {
  type Actor,
  type CoreContext,
  getSettings,
  hasCredential,
  setCredential,
} from "@tgbox/core";
import { listBotChats } from "@tgbox/db";
import { BotSettings, PaymentSettings, SiteSettings } from "@tgbox/shared";
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
      welcome: z.object({ zh: z.string().max(2000), en: z.string().max(2000) }),
    }),
  }),
  z.object({
    key: z.literal("site"),
    value: SiteSettings.extend({
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
 * is write-only (`hasCryptoPayToken`).
 */
export async function loadSettingsView(core: CoreContext, env: SettingsEnv) {
  const [settings, chats, hasCryptoPayToken] = await Promise.all([
    getSettings(core),
    listBotChats(core.db),
    hasCredential(core, "cryptopay_token"),
  ]);
  const chatOption = ({ chatId, title, username }: (typeof chats)[number]) => ({
    chatId,
    title,
    username,
  });
  return {
    settings,
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
