import type {
  ActivityTier,
  BannerContent,
  EntryKind,
  EntryStatus,
  Liveness,
  Locale,
  OrderStatus,
  PaymentCurrency,
  PaymentProvider,
  ProductKind,
  SettingsKey,
  SubmissionStatus,
} from "@tgbox/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  /**
   * Workers AI translations of `description`, written by the hourly cron. Both are cleared when
   * the source description changes, so a stale translation never reaches the site.
   */
  descriptionZh: text("description_zh"),
  descriptionEn: text("description_en"),
  /** Last translation attempt, including the ones skipped as too short/long (so they aren't retried). */
  descriptionTranslatedAt: integer("description_translated_at"),
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
  /** Hide every post preview of this entry on the site. */
  hidePosts: integer("hide_posts", { mode: "boolean" }).notNull().default(false),
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
    // The Mini App lists a user's own submissions on every app open (see .agents/database.md).
    index("submissions_user").on(t.tgUserId, t.id),
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
  /** `tg:<user id>`, `email:<address>` or `system` */
  actor: text().notNull(),
  action: text().notNull(),
  target: text(),
  payload: text({ mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at").notNull(),
});

// One row per top-level settings key; `value` is JSON validated by the zod schemas in @tgbox/shared.
export const settings = sqliteTable("settings", {
  key: text().$type<SettingsKey>().primaryKey(),
  value: text().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Third-party secrets entered in the admin, AES-GCM encrypted with SETTINGS_KEY. Write-only. */
export const credentials = sqliteTable("credentials", {
  key: text().$type<"cryptopay_token" | "trongrid_key">().primaryKey(),
  ciphertext: text().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Chats the bot is a member of (from `my_chat_member`), for picking review/publish chats. */
export const botChats = sqliteTable("bot_chats", {
  chatId: text("chat_id").primaryKey(),
  type: text().$type<"private" | "group" | "supergroup" | "channel">().notNull(),
  title: text().notNull(),
  username: text(),
  /** Telegram chat member status of the bot: creator, administrator, member, restricted, left, kicked. */
  status: text().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const products = sqliteTable("products", {
  id: integer().primaryKey(),
  kind: text().$type<ProductKind>().notNull(),
  nameZh: text("name_zh").notNull(),
  nameEn: text("name_en").notNull(),
  days: integer().notNull(),
  priceStars: integer("price_stars").notNull(),
  /** Decimal string, e.g. "10" or "9.5". */
  priceUsdt: text("price_usdt").notNull(),
  /** Concurrent slots for the kind = max `slots` over that kind's products. */
  slots: integer().notNull(),
  active: integer({ mode: "boolean" }).notNull().default(true),
  sort: integer().notNull().default(0),
});

// Private (user ids): never exported to the site build.
export const orders = sqliteTable(
  "orders",
  {
    id: integer().primaryKey(),
    tgUserId: integer("tg_user_id").notNull(),
    productId: integer("product_id").notNull(),
    kind: text().$type<ProductKind>().notNull(),
    days: integer().notNull(),
    targetUsername: text("target_username"),
    banner: text({ mode: "json" }).$type<BannerContent>(),
    status: text().$type<OrderStatus>().notNull().default("pending"),
    provider: text().$type<PaymentProvider>(),
    amount: text(),
    currency: text().$type<PaymentCurrency>(),
    invoiceId: text("invoice_id"),
    chargeId: text("charge_id"),
    note: text(),
    createdAt: integer("created_at").notNull(),
    paidAt: integer("paid_at"),
    startsAt: integer("starts_at"),
    endsAt: integer("ends_at"),
    /** Set once the renewal reminder was sent. */
    remindedAt: integer("reminded_at"),
  },
  (t) => [
    // Idempotency for payment callbacks; partial so unpaid orders don't pay the index row.
    uniqueIndex("orders_provider_charge_unique")
      .on(t.provider, t.chargeId)
      .where(sql`charge_id IS NOT NULL`),
    // The Mini App lists a buyer's own orders on every app open (see .agents/database.md).
    index("orders_user").on(t.tgUserId, t.id),
  ],
);

// Public: exported to the site build. Rows are deleted when they expire.
export const promotions = sqliteTable("promotions", {
  id: integer().primaryKey(),
  kind: text().$type<ProductKind>().notNull(),
  /** null for promotions created manually in the admin */
  orderId: integer("order_id"),
  entryUsername: text("entry_username"),
  banner: text({ mode: "json" }).$type<BannerContent>(),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * One order awaiting an on-chain USDT transfer. `amount_micro` is the order's fingerprint: the
 * watcher matches an incoming transfer to an order by its exact integer amount, so no two unpaid
 * orders may hold the same value. Only the receiving address is ever stored — never a key.
 *
 * Migration 0010 puts a partial index on `amount_micro WHERE status = 'pending'` (drizzle-kit
 * can't express the predicate), so a row only pays for the index while it is actually waiting.
 */
export const usdtPayments = sqliteTable("usdt_payments", {
  orderId: integer("order_id").primaryKey(),
  chain: text().$type<"trc20">().notNull().default("trc20"),
  /** USDT x 1e6, compared as an integer so no rounding can decide whether an order was paid. */
  amountMicro: integer("amount_micro").notNull(),
  /** The receiving address as configured when the order was placed, not as configured now. */
  address: text().notNull(),
  status: text().$type<"pending" | "paid" | "expired">().notNull().default("pending"),
  txHash: text("tx_hash"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  paidAt: integer("paid_at"),
});

/** Bot language chosen with /lang; absent = follow the Telegram client language. */
export const userPrefs = sqliteTable("user_prefs", {
  tgUserId: integer("tg_user_id").primaryKey(),
  locale: text().$type<Locale>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** One forum topic per user in the support group; the relay maps both ways through this table. */
export const supportThreads = sqliteTable(
  "support_threads",
  {
    tgUserId: integer("tg_user_id").primaryKey(),
    topicId: integer("topic_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  // Lookup key for the admin side of the relay (message_thread_id → user).
  (t) => [uniqueIndex("support_threads_topic_unique").on(t.topicId)],
);

/** Post previews hidden by a moderator; the snapshot drops them from the site. */
export const hiddenPosts = sqliteTable(
  "hidden_posts",
  {
    entryId: integer("entry_id").notNull(),
    postId: integer("post_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.postId] })],
);

/**
 * Clicks on paid promotions, aggregated per UTC day. The public redirect route (`/r/:id`) upserts
 * `clicks = clicks + 1`, so a click costs exactly one row written; the primary key is the only
 * index, so there is no second row per write. Rows outlive the promotion they belong to: a
 * promotion is deleted when it expires, but the advertiser's report must survive it.
 *
 * Migration 0008 creates the table `WITHOUT ROWID` (drizzle-kit can't express that): the
 * primary key is then the table itself, so a click costs one row written instead of two.
 */
export const promotionClicks = sqliteTable(
  "promotion_clicks",
  {
    promotionId: integer("promotion_id").notNull(),
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: text().notNull(),
    clicks: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.promotionId, t.day] })],
);
