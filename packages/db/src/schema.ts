import type {
  ActivityTier,
  BannerContent,
  EntryKind,
  EntryStatus,
  Liveness,
  OrderStatus,
  PaymentCurrency,
  PaymentProvider,
  ProductKind,
  SettingsKey,
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
  key: text().$type<"cryptopay_token">().primaryKey(),
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
  // Idempotency for payment callbacks; partial so unpaid orders don't pay the index row.
  (t) => [
    uniqueIndex("orders_provider_charge_unique")
      .on(t.provider, t.chargeId)
      .where(sql`charge_id IS NOT NULL`),
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
