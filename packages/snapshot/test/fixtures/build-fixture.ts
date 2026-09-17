import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EntryKind, EntryStatus, MemberPoint, PostView } from "@tgbox/shared";

const migrationsDir = path.resolve(import.meta.dirname, "../../../db/migrations");

/** Clock used for all fixture timestamps. */
export const fixtureNow = new Date("2026-09-01T00:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

export type FixtureEntry = {
  username: string;
  kind: EntryKind;
  category: string;
  tags: string[];
  title: string;
  description?: string;
  /** Machine translations written by the bot (migration 0009); absent on most fixture entries. */
  descriptionZh?: string;
  descriptionEn?: string;
  lang?: string;
  status?: EntryStatus;
  verified?: boolean;
  promoted?: boolean;
  avatarVersion?: string;
  members?: number;
  online?: number;
  activityTier?: number;
  listedDaysAgo: number;
};

export const fixtureEntries: FixtureEntry[] = [
  {
    username: "techdaily",
    kind: "channel",
    category: "tech",
    tags: ["programming", "chinese"],
    title: "每日科技",
    description: "每天分享开发与科技新闻",
    descriptionZh: "每天分享开发与科技新闻",
    descriptionEn: "Daily development and tech news.",
    lang: "zh",
    avatarVersion: "a1",
    members: 5000,
    activityTier: 4,
    listedDaysAgo: 30,
  },
  {
    username: "devnotes",
    kind: "channel",
    category: "tech",
    tags: ["programming"],
    title: "Dev Notes",
    description: "Notes about programming",
    lang: "en",
    members: 3000,
    activityTier: 2,
    listedDaysAgo: 20,
  },
  {
    username: "worldnews",
    kind: "channel",
    category: "news",
    tags: ["daily-news", "chinese"],
    title: "环球早报",
    lang: "zh",
    verified: true,
    members: 20000,
    activityTier: 3,
    listedDaysAgo: 10,
  },
  {
    username: "aiwatch",
    kind: "channel",
    category: "ai",
    tags: ["chatgpt", "programming"],
    title: "AI 观察",
    lang: "zh",
    promoted: true,
    members: 8000,
    activityTier: 1,
    listedDaysAgo: 5,
  },
  {
    username: "movieshare",
    kind: "channel",
    category: "video",
    tags: ["movies"],
    title: "电影分享",
    members: 100,
    activityTier: 0,
    listedDaysAgo: 3,
  },
  {
    username: "hiddenchan",
    kind: "channel",
    category: "tech",
    tags: ["programming"],
    title: "隐藏频道",
    status: "hidden_by_system",
    members: 99999,
    listedDaysAgo: 40,
  },
  {
    username: "removedchan",
    kind: "channel",
    category: "tech",
    tags: ["programming", "chinese"],
    title: "已删除频道",
    status: "removed",
    members: 88888,
    listedDaysAgo: 50,
  },
  {
    username: "devchat",
    kind: "group",
    category: "tech",
    tags: ["programming"],
    title: "开发者交流群",
    lang: "zh",
    members: 1200,
    online: 30,
    listedDaysAgo: 15,
  },
  {
    username: "chitchat",
    kind: "group",
    category: "chat",
    tags: ["chinese"],
    title: "闲聊群",
    members: 400,
    online: 5,
    listedDaysAgo: 12,
  },
  {
    username: "vpsclub",
    kind: "group",
    category: "vps",
    tags: ["vpn"],
    title: "VPS Club",
    lang: "en",
    members: 900,
    listedDaysAgo: 8,
  },
  {
    username: "adminhidden",
    kind: "group",
    category: "tech",
    tags: ["programming"],
    title: "管理员隐藏群",
    status: "hidden_by_admin",
    members: 7777,
    listedDaysAgo: 9,
  },
  {
    username: "helperbot",
    kind: "bot",
    category: "tools",
    tags: ["free"],
    title: "小助手",
    listedDaysAgo: 7,
  },
  {
    username: "gptbot",
    kind: "bot",
    category: "ai",
    tags: ["chatgpt"],
    title: "GPT Bot",
    lang: "en",
    members: 10000,
    listedDaysAgo: 1,
  },
];

/**
 * Creates a SQLite file shaped like an exported D1 database: applies every
 * `packages/db/migrations/*.sql` (0002 seeds all categories/tags from @tgbox/shared) and
 * inserts `entries` (defaults to `fixtureEntries`). Returns `dbPath`.
 */
export function buildFixtureDb(dbPath: string, entries: FixtureEntry[] = fixtureEntries): string {
  const db = new DatabaseSync(dbPath);
  try {
    for (const file of readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }

    const insertEntry = db.prepare(
      `INSERT INTO entries (username, kind, category_id, title, description, description_zh,
         description_en, lang, verified, avatar_version, tg_created_at, listed_at, status,
         is_promoted, updated_at)
       VALUES (?, ?, (SELECT id FROM categories WHERE kind = ? AND slug = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );
    const insertStats = db.prepare(
      "INSERT INTO entry_stats (entry_id, members, online, activity_tier, stats_written_at) VALUES (?, ?, ?, ?, ?)",
    );
    const insertEntryTag = db.prepare(
      "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE slug = ?))",
    );
    const now = fixtureNow.getTime();
    for (const e of entries) {
      const listedAt = now - e.listedDaysAgo * day;
      const row = insertEntry.get(
        e.username,
        e.kind,
        e.kind,
        e.category,
        e.title,
        e.description ?? "",
        e.descriptionZh ?? null,
        e.descriptionEn ?? null,
        e.lang ?? null,
        e.verified ? 1 : 0,
        e.avatarVersion ?? null,
        listedAt - 365 * day,
        listedAt,
        e.status ?? "approved",
        e.promoted ? 1 : 0,
        listedAt,
      );
      const id = row?.id;
      if (typeof id !== "number") throw new Error(`fixture insert failed: ${e.username}`);
      if (e.members !== undefined || e.online !== undefined || e.activityTier !== undefined) {
        insertStats.run(id, e.members ?? null, e.online ?? null, e.activityTier ?? null, now);
      }
      for (const tag of e.tags) insertEntryTag.run(id, tag);
    }
  } finally {
    db.close();
  }
  return dbPath;
}

export const fixturePosts: PostView[] = [
  { id: 2, date: "2026-08-31T12:00:00.000Z", text: "第二条消息", views: 1200 },
  { id: 1, date: "2026-08-30T12:00:00.000Z", text: "First post", views: null },
];

export const fixtureHistory: MemberPoint[] = [
  { t: "2026-08-18T00:00:00.000Z", members: 4800 },
  { t: "2026-08-25T00:00:00.000Z", members: 5000 },
];

/**
 * Writes an R2-shaped media directory (`posts/<u>.json`, `history/<u>.json`) with data for
 * `techdaily` only; every other entry has no media files. Returns `mediaDir`.
 */
export function writeFixtureMedia(mediaDir: string): string {
  mkdirSync(path.join(mediaDir, "posts"), { recursive: true });
  mkdirSync(path.join(mediaDir, "history"), { recursive: true });
  writeFileSync(path.join(mediaDir, "posts/techdaily.json"), JSON.stringify(fixturePosts));
  writeFileSync(path.join(mediaDir, "history/techdaily.json"), JSON.stringify(fixtureHistory));
  return mediaDir;
}
