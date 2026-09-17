import { z } from "zod";
import { ActivityTier, EntryKind } from "./domain.ts";

/**
 * Snapshot contract: produced by @tgbox/snapshot at build time, consumed by apps/web.
 * The zod schemas are the source of truth; types are inferred from them.
 */

export const PostView = z.object({
  id: z.number().int(),
  /** ISO 8601 timestamp */
  date: z.string(),
  text: z.string(),
  views: z.number().int().nullable(),
  mediaThumb: z.string().optional(),
});
export type PostView = z.infer<typeof PostView>;

export const MemberPoint = z.object({
  /** ISO 8601 timestamp */
  t: z.string(),
  members: z.number().int(),
});
export type MemberPoint = z.infer<typeof MemberPoint>;

/** Usernames of related entries (same category + tag overlap, up to 6 each). */
export const RelatedRefs = z.object({
  channels: z.array(z.string()),
  groups: z.array(z.string()),
});
export type RelatedRefs = z.infer<typeof RelatedRefs>;

export const EntryView = z.object({
  username: z.string(),
  kind: EntryKind,
  /** category slug (unique within kind) */
  category: z.string(),
  /** tag slugs */
  tags: z.array(z.string()),
  title: z.string(),
  description: z.string(),
  /**
   * Machine translation of `description` (Workers AI, hourly cron). Only the language the source
   * text is *not* written in is filled in — the other stays null and `description` is the text to
   * show. Both are null while no translation exists (too short, too long, or not translated yet).
   */
  descriptionZh: z.string().nullable().default(null),
  descriptionEn: z.string().nullable().default(null),
  /** detected language code (e.g. "zh", "en"), null when unknown */
  lang: z.string().nullable(),
  verified: z.boolean(),
  /** absolute URL under R2_PUBLIC_URL, null when no avatar */
  avatarUrl: z.string().nullable(),
  members: z.number().int().nullable(),
  /** groups: online count; bots: null (monthly users are stored in members) */
  online: z.number().int().nullable(),
  activityTier: ActivityTier.nullable(),
  /** ISO 8601 */
  tgCreatedAt: z.string().nullable(),
  /** ISO 8601 */
  listedAt: z.string(),
  /**
   * ISO 8601; last time the entry's own content changed (title, description, avatar, …). Stat
   * refreshes don't touch it, which is what makes it usable as a sitemap `<lastmod>`.
   */
  updatedAt: z.string(),
  isPromoted: z.boolean(),
  posts: z.array(PostView),
  memberHistory: z.array(MemberPoint),
  related: RelatedRefs,
});
export type EntryView = z.infer<typeof EntryView>;

export const SiteStats = z.object({
  total: z.number().int(),
  channels: z.number().int(),
  groups: z.number().int(),
  bots: z.number().int(),
});
export type SiteStats = z.infer<typeof SiteStats>;

export const CategoryView = z.object({
  slug: z.string(),
  kind: EntryKind,
  nameZh: z.string(),
  nameEn: z.string(),
  sort: z.number().int(),
  /** Icon key (see `categoryIcons`); null = the web picks one from the slug. */
  icon: z.string().nullable(),
  count: z.number().int(),
});
export type CategoryView = z.infer<typeof CategoryView>;

export const TagView = z.object({
  slug: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  count: z.number().int(),
});
export type TagView = z.infer<typeof TagView>;

/** Random-bottle shards: usernames of approved entries per kind, plus "all". */
export const RandomShardKey = z.enum([...EntryKind.options, "all"]);
export type RandomShardKey = z.infer<typeof RandomShardKey>;

/** Site-wide announcement bar (admin setting); both locales always present. */
export const AnnouncementView = z.object({
  zh: z.string(),
  en: z.string(),
  href: z.string().nullable(),
});
export type AnnouncementView = z.infer<typeof AnnouncementView>;

/** A paid home banner that is live at build time. */
export const PromoView = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  href: z.string(),
  /** Absolute URL of the uploaded card image, null for banners sold without one. */
  imageUrl: z.string().nullable().default(null),
  sponsored: z.literal(true),
});
export type PromoView = z.infer<typeof PromoView>;

export const SiteData = z.object({
  /** ISO 8601 */
  generatedAt: z.string(),
  stats: SiteStats,
  categories: z.array(CategoryView),
  tags: z.array(TagView),
  entries: z.array(EntryView),
  randomShards: z.record(RandomShardKey, z.array(z.string())),
  /** null when disabled */
  announcement: AnnouncementView.nullable(),
  /** Live paid banners, ordered by start time. */
  promos: z.array(PromoView),
});
export type SiteData = z.infer<typeof SiteData>;
