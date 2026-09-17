import type {
  ActivityTier,
  EntryKind,
  EntryStatus,
  Liveness,
  SubmissionStatus,
} from "@tgbox/shared";
import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Timestamps are unix epoch milliseconds (integer columns).

export const categories = sqliteTable(
  "categories",
  {
    id: integer().primaryKey(),
    slug: text().notNull(),
    kind: text().$type<EntryKind>().notNull(),
    nameZh: text("name_zh").notNull(),
    nameEn: text("name_en").notNull(),
    sort: integer().notNull(),
    /** Icon key rendered by the web (see `categoryIcons` in @tgbox/shared); null = generic icon. */
    icon: text(),
  },
  // Conflict target for taxonomy sync; slugs repeat across kinds.
  (t) => [uniqueIndex("categories_kind_slug_unique").on(t.kind, t.slug)],
);

export const tags = sqliteTable("tags", {
  id: integer().primaryKey(),
  slug: text().notNull().unique(),
  nameZh: text("name_zh").notNull(),
  nameEn: text("name_en").notNull(),
});

export const entries = sqliteTable("entries", {
  id: integer().primaryKey(),
  username: text().notNull().unique(),
  kind: text().$type<EntryKind>().notNull(),
  categoryId: integer("category_id").notNull(),
  title: text().notNull(),
  description: text().notNull().default(""),
  lang: text(),
  verified: integer({ mode: "boolean" }).notNull().default(false),
  avatarVersion: text("avatar_version"),
  tgCreatedAt: integer("tg_created_at"),
  listedAt: integer("listed_at").notNull(),
  status: text().$type<EntryStatus>().notNull().default("approved"),
  liveness: text().$type<Liveness>().notNull().default("active"),
  failCount: integer("fail_count").notNull().default(0),
  firstFailAt: integer("first_fail_at"),
  lastFailAt: integer("last_fail_at"),
  isPromoted: integer("is_promoted", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});

export const entryStats = sqliteTable("entry_stats", {
  entryId: integer("entry_id").primaryKey(),
  members: integer(),
  online: integer(),
  activityTier: integer("activity_tier").$type<ActivityTier>(),
  statsWrittenAt: integer("stats_written_at").notNull(),
});

export const entryTags = sqliteTable(
  "entry_tags",
  {
    entryId: integer("entry_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] })],
);

export const submissions = sqliteTable(
  "submissions",
  {
    id: integer().primaryKey(),
    tgUserId: integer("tg_user_id").notNull(),
    username: text().notNull(),
    kind: text().$type<EntryKind>().notNull(),
    categoryId: integer("category_id").notNull(),
    tagIds: text("tag_ids", { mode: "json" }).$type<number[]>().notNull(),
    fetchedTitle: text("fetched_title"),
    fetchedDescription: text("fetched_description"),
    fetchedMembers: integer("fetched_members"),
    status: text().$type<SubmissionStatus>().notNull().default("pending"),
    rejectReason: text("reject_reason"),
    reviewerId: integer("reviewer_id"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    adminMessageId: integer("admin_message_id"),
  },
  (t) => [
    uniqueIndex("submissions_pending_username_unique")
      .on(t.username)
      .where(sql`status = 'pending'`),
  ],
);

export const blacklist = sqliteTable(
  "blacklist",
  {
    type: text().$type<"user" | "username">().notNull(),
    value: text().notNull(),
    reason: text(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.type, t.value] })],
);

export const botDrafts = sqliteTable("bot_drafts", {
  tgUserId: integer("tg_user_id").primaryKey(),
  step: text().notNull(),
  payload: text({ mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const siteState = sqliteTable("site_state", {
  key: text().primaryKey(),
  value: text().notNull(),
});

// Append-only admin/bot action log. Only the primary key: every extra index costs a row per write.
export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey(),
  /** `tg:<user id>` or `email:<address>` */
  actor: text().notNull(),
  action: text().notNull(),
  target: text(),
  payload: text({ mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at").notNull(),
});
