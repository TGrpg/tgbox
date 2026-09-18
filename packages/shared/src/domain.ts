import { z } from "zod";

export const entryKinds = ["channel", "group", "bot"] as const;
export const EntryKind = z.enum(entryKinds);
export type EntryKind = z.infer<typeof EntryKind>;

export const EntryStatus = z.enum(["approved", "hidden_by_system", "hidden_by_admin", "removed"]);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const Liveness = z.enum(["active", "not_found", "banned", "type_changed", "unknown"]);
export type Liveness = z.infer<typeof Liveness>;

/** 0 = dormant … 4 = very active. Groups and bots have no tier (null). */
export const ActivityTier = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type ActivityTier = z.infer<typeof ActivityTier>;

export const SubmissionStatus = z.enum(["pending", "approved", "rejected"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/** Icon keys the web knows how to render (Tabler icon names); admin picks one per category. */
export const categoryIcons = [
  "news",
  "movie",
  "apps",
  "share",
  "school",
  "mood-happy",
  "book",
  "article",
  "photo",
  "code",
  "sparkles",
  "discount",
  "device-gamepad-2",
  "sticker",
  "compass",
  "message-circle",
  "heart",
  "server",
  "brand-apple",
  "dots",
  "tool",
  "send",
  "shield",
  "search",
  "download",
  // Added 2026-09 with the taxonomy expansion; `CategoryIcon.astro` and the admin's icon picker
  // render the same keys, so a new one has to land in all three.
  "gift",
  "coin",
  "world",
  "cloud",
  "briefcase",
  "map-pin",
  "building-store",
  "folder",
  "chart-line",
  "coffee",
  "category",
] as const;
export type CategoryIcon = (typeof categoryIcons)[number];

/** Most tags one entry may carry (bot submit, bot admin, admin UI and core all enforce it). */
export const MAX_TAGS = 5;

/** Sort orders of the admin entries table. */
export const entrySorts = ["id_desc", "id_asc", "members_desc", "updated_desc"] as const;
export type EntrySort = (typeof entrySorts)[number];

export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];

/** Who an admin broadcast goes to; language follows /lang, else the Telegram client language. */
export const BroadcastAudience = z.enum(["all", "zh", "en", "paying", "submitters", "active30"]);
export type BroadcastAudience = z.infer<typeof BroadcastAudience>;

export const BroadcastStatus = z.enum(["running", "paused", "done", "cancelled"]);
export type BroadcastStatus = z.infer<typeof BroadcastStatus>;

/** Plain text, or Telegram's HTML subset (<b>, <i>, <u>, <s>, <a>, <code>, <pre>, <blockquote>…). */
export const BroadcastFormat = z.enum(["plain", "html"]);
export type BroadcastFormat = z.infer<typeof BroadcastFormat>;

export const BroadcastMediaType = z.enum(["photo", "video", "animation", "document"]);
export type BroadcastMediaType = z.infer<typeof BroadcastMediaType>;

export const BroadcastMedia = z.object({
  type: BroadcastMediaType,
  fileId: z.string().min(1).max(300),
});
export type BroadcastMedia = z.infer<typeof BroadcastMedia>;

export const BroadcastButton = z.object({
  text: z.string().trim().min(1).max(40),
  url: z
    .string()
    .trim()
    .regex(/^https:\/\/\S+$/)
    .max(2048),
});
export type BroadcastButton = z.infer<typeof BroadcastButton>;

/**
 * One message as the admin composes it, for a broadcast or a single user. Telegram caps a caption
 * at 1024 characters and a message at 4096, so the limit follows the media.
 */
export const OutgoingMessage = z
  .object({
    text: z.string().trim().max(4096),
    format: BroadcastFormat,
    media: BroadcastMedia.nullable(),
    buttons: z.array(BroadcastButton).max(8),
    buttonsPerRow: z.number().int().min(1).max(3),
    silent: z.boolean(),
    protect: z.boolean(),
    noPreview: z.boolean(),
  })
  .refine((m) => m.text.length > 0 || m.media !== null, "empty")
  .refine((m) => m.media === null || m.text.length <= 1024, "caption too long");
export type OutgoingMessage = z.infer<typeof OutgoingMessage>;
