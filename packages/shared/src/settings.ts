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
  /** Forum ("topics") group the two-way support relay writes to; null = no relay. */
  supportGroupId: chatId.nullable(),
  /** Master switch for the relay; the group id still has to be set. */
  supportEnabled: z.boolean(),
  /** Empty string = built-in text. */
  welcome: z.object({ zh: z.string(), en: z.string() }),
});
export type BotSettings = z.infer<typeof BotSettings>;

/** Most substrings the post blocklist may hold; the snapshot scans every post against all of them. */
export const MAX_POST_BLOCKLIST = 100;

export const SiteSettings = z.object({
  announcement: z.object({
    enabled: z.boolean(),
    zh: z.string(),
    en: z.string(),
    href: z.string().nullable(),
  }),
  /** Case-insensitive substrings; a post containing any of them is dropped from the snapshot. */
  postBlocklist: z.array(z.string()).max(MAX_POST_BLOCKLIST),
  /** Drop post media thumbnails site-wide (text previews stay). */
  hidePostMedia: z.boolean(),
  /**
   * Fill the unsold sponsor slots with "this space is for rent" cards. Off by default: with no
   * paid promotions the section would otherwise still render, which reads as an ad nobody can
   * turn off.
   */
  showAdSlots: z.boolean(),
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
    supportGroupId: null,
    supportEnabled: true,
    welcome: { zh: "", en: "" },
  },
  site: {
    announcement: { enabled: false, zh: "", en: "", href: null },
    postBlocklist: [],
    hidePostMedia: false,
    showAdSlots: false,
  },
  payments: { starsEnabled: true, cryptoPayEnabled: false, cryptoPayNetwork: "mainnet" },
};

/** True when a post preview contains one of the blocked substrings (case-insensitive). */
export function shouldHidePost(text: string, blocklist: string[]): boolean {
  const haystack = text.toLowerCase();
  return blocklist.some((word) => {
    const needle = word.trim().toLowerCase();
    return needle !== "" && haystack.includes(needle);
  });
}

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
  /**
   * Optional card image, uploaded to `promos/<order id>.jpg` under R2_PUBLIC_URL. Absent on
   * every banner sold before image upload existed, so it stays optional everywhere.
   * Validated loosely (https only): the media host is configuration, not user input.
   */
  imageUrl: z
    .string()
    .trim()
    .max(300)
    .refine(isHttpsUrl, "must be an https:// URL")
    .nullable()
    .optional(),
});
export type BannerContent = z.infer<typeof BannerContent>;
