import { z } from "zod";

/* ---------------------------------------------------------------- settings */

// Each top-level key is one D1 `settings` row holding JSON. Reads parse with these schemas and
// fall back to `settingsDefaults` per key, so a bad row never breaks the bot or the build.

const chatId = z.string().regex(/^-?\d+$/);

export const ReviewMode = z.enum(["chat", "admins"]);
export type ReviewMode = z.infer<typeof ReviewMode>;

export const BotSettings = z.object({
  /** "chat": the review chat; "admins": a private copy to every admin. */
  reviewMode: ReviewMode,
  /** null → env ADMIN_CHAT_ID */
  reviewChatId: chatId.nullable(),
  /** Approved entries are announced here; null = don't publish. */
  publishChannelId: chatId.nullable(),
  /** Daily 09:00 (Beijing) rankings digest in the publish channel. */
  dailyDigest: z.boolean(),
  /** Union with env ADMIN_IDS (super admins). */
  extraAdminIds: z.array(z.string().regex(/^\d+$/)),
  submissionsOpen: z.boolean(),
  submitDailyLimit: z.number().int().min(1).max(100),
  /** Without the leading @. */
  supportUsername: z.string().nullable(),
  /** Empty string = built-in text. */
  welcome: z.object({ zh: z.string(), en: z.string() }),
});
export type BotSettings = z.infer<typeof BotSettings>;

export const SiteSettings = z.object({
  announcement: z.object({
    enabled: z.boolean(),
    zh: z.string(),
    en: z.string(),
    href: z.string().nullable(),
  }),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

export const PaymentSettings = z.object({
  starsEnabled: z.boolean(),
  cryptoPayEnabled: z.boolean(),
  cryptoPayNetwork: z.enum(["mainnet", "testnet"]),
});
export type PaymentSettings = z.infer<typeof PaymentSettings>;

export const SettingsKey = z.enum(["bot", "site", "payments"]);
export type SettingsKey = z.infer<typeof SettingsKey>;

export type Settings = { bot: BotSettings; site: SiteSettings; payments: PaymentSettings };

export const settingsDefaults: Settings = {
  bot: {
    reviewMode: "chat",
    reviewChatId: null,
    publishChannelId: null,
    dailyDigest: true,
    extraAdminIds: [],
    submissionsOpen: true,
    submitDailyLimit: 5,
    supportUsername: null,
    welcome: { zh: "", en: "" },
  },
  site: { announcement: { enabled: false, zh: "", en: "", href: null } },
  payments: { starsEnabled: true, cryptoPayEnabled: false, cryptoPayNetwork: "mainnet" },
};

/** Private review copies are capped so one notice stays well inside the subrequest budget. */
export const MAX_REVIEW_RECIPIENTS = 10;

/**
 * Chat ids that receive review messages. "chat" mode uses the review chat (settings, then env
 * ADMIN_CHAT_ID) and falls back to private copies when neither is set; "admins" mode sends a copy
 * to each admin (env ADMIN_IDS ∪ extraAdminIds), capped at MAX_REVIEW_RECIPIENTS.
 */
export function reviewRecipients(
  bot: Pick<BotSettings, "reviewMode" | "reviewChatId" | "extraAdminIds">,
  env: { ADMIN_IDS?: string; ADMIN_CHAT_ID?: string },
): { mode: ReviewMode; chatIds: string[] } {
  const chat = bot.reviewChatId ?? (env.ADMIN_CHAT_ID || null);
  if (bot.reviewMode === "chat" && chat) return { mode: "chat", chatIds: [chat] };
  const admins = new Set([
    ...(env.ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    ...bot.extraAdminIds,
  ]);
  return { mode: "admins", chatIds: [...admins].slice(0, MAX_REVIEW_RECIPIENTS) };
}

/* -------------------------------------------------------------- promotions */

export const ProductKind = z.enum(["pin", "banner"]);
export type ProductKind = z.infer<typeof ProductKind>;

/**
 * pending → paid → active → expired. Banners are reviewed: paid → active, or paid → rejected →
 * refunded. Unpaid orders are deleted by the cleanup job (`cancelled` is for explicit cancels).
 */
export const OrderStatus = z.enum([
  "pending",
  "paid",
  "active",
  "expired",
  "rejected",
  "refunded",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const PaymentProvider = z.enum(["stars", "cryptopay", "manual"]);
export type PaymentProvider = z.infer<typeof PaymentProvider>;

export const PaymentCurrency = z.enum(["XTR", "USDT"]);
export type PaymentCurrency = z.infer<typeof PaymentCurrency>;

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Home banner card. Users write one language; both locales show the same content. */
export const BannerContent = z.object({
  title: z.string().trim().min(1).max(20),
  subtitle: z.string().trim().min(1).max(40),
  /** https:// URL (t.me links included). */
  href: z.string().trim().max(300).refine(isHttpsUrl, "must be an https:// URL"),
});
export type BannerContent = z.infer<typeof BannerContent>;
