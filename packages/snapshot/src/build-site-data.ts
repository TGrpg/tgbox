import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EntryKind, MemberPoint, PostView, SiteData } from "@tgbox/shared";

export type BuildSiteDataOptions = {
  /** Exported D1 database: a SQLite file, or a `.sql` dump as produced by `wrangler d1 export`. */
  dbPath: string;
  /** Public R2 base URL; used for avatar URLs and, without `mediaDir`, to fetch media JSON. */
  mediaBaseUrl?: string;
  /** Local copy of the media bucket (`posts/<u>.json`, `history/<u>.json`). */
  mediaDir?: string;
  fetch?: typeof fetch;
  now: Date;
};

const RELATED_LIMIT = 6;
const FETCH_CONCURRENCY = 16;

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected text column, got ${typeof value}`);
  return value;
}

function int(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Error(`expected integer column, got ${typeof value}`);
  return value;
}

function intOrNull(value: unknown): number | null {
  return value === null ? null : int(value);
}

function isoOrNull(ms: unknown): string | null {
  return ms === null ? null : new Date(int(ms)).toISOString();
}

export async function buildSiteData(options: BuildSiteDataOptions): Promise<SiteData> {
  const { dbPath, mediaDir, now } = options;
  const mediaBaseUrl = options.mediaBaseUrl?.replace(/\/+$/, "");

  const isSqlDump = dbPath.endsWith(".sql");
  const db = isSqlDump
    ? new DatabaseSync(":memory:")
    : new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (isSqlDump) db.exec(await readFile(dbPath, "utf8"));
    return await build(db);
  } finally {
    db.close();
  }

  async function build(db: DatabaseSync): Promise<SiteData> {
    const rows = db
      .prepare(
        `SELECT e.id, e.username, e.kind, e.category_id, c.slug AS category, e.title, e.description,
           e.lang, e.verified, e.avatar_version, e.tg_created_at, e.listed_at, e.is_promoted,
           s.members, s.online, s.activity_tier
         FROM entries e
         JOIN categories c ON c.id = e.category_id
         LEFT JOIN entry_stats s ON s.entry_id = e.id
         WHERE e.status = 'approved'
         ORDER BY e.listed_at DESC, e.username`,
      )
      .all();

    const tagsByEntry = new Map<number, string[]>();
    for (const row of db
      .prepare(
        `SELECT et.entry_id, t.slug FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         JOIN entries e ON e.id = et.entry_id AND e.status = 'approved'
         ORDER BY t.slug`,
      )
      .all()) {
      const id = int(row.entry_id);
      tagsByEntry.set(id, [...(tagsByEntry.get(id) ?? []), text(row.slug)]);
    }

    const entries = rows.map((row) => {
      const id = int(row.id);
      const username = text(row.username);
      const kind = EntryKind.parse(row.kind);
      const avatarVersion = row.avatar_version === null ? null : text(row.avatar_version);
      return {
        id,
        categoryId: int(row.category_id),
        username,
        kind,
        category: text(row.category),
        tags: tagsByEntry.get(id) ?? [],
        title: text(row.title),
        description: text(row.description),
        lang: row.lang === null ? null : text(row.lang),
        verified: int(row.verified) === 1,
        avatarUrl:
          avatarVersion !== null && mediaBaseUrl
            ? `${mediaBaseUrl}/avatars/${username}.jpg?v=${encodeURIComponent(avatarVersion)}`
            : null,
        members: intOrNull(row.members),
        online: intOrNull(row.online),
        activityTier: intOrNull(row.activity_tier),
        tgCreatedAt: isoOrNull(row.tg_created_at),
        listedAt: new Date(int(row.listed_at)).toISOString(),
        isPromoted: int(row.is_promoted) === 1,
      };
    });

    const media = await loadMedia(entries);

    const categoryRows = db
      .prepare(
        `SELECT c.slug, c.kind, c.name_zh, c.name_en, c.sort, c.icon,
           (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id AND e.status = 'approved') AS count
         FROM categories c ORDER BY c.kind, c.sort, c.slug`,
      )
      .all();
    const tagRows = db
      .prepare(
        `SELECT t.slug, t.name_zh, t.name_en,
           (SELECT COUNT(*) FROM entry_tags et JOIN entries e ON e.id = et.entry_id
             WHERE et.tag_id = t.id AND e.status = 'approved') AS count
         FROM tags t ORDER BY t.slug`,
      )
      .all();

    const usernamesOf = (kind: EntryKind) =>
      entries.filter((e) => e.kind === kind).map((e) => e.username);

    return SiteData.parse({
      generatedAt: now.toISOString(),
      stats: {
        total: entries.length,
        channels: usernamesOf("channel").length,
        groups: usernamesOf("group").length,
        bots: usernamesOf("bot").length,
      },
      categories: categoryRows.map((row) => ({
        slug: text(row.slug),
        kind: EntryKind.parse(row.kind),
        nameZh: text(row.name_zh),
        nameEn: text(row.name_en),
        sort: int(row.sort),
        icon: row.icon === null ? null : text(row.icon),
        count: int(row.count),
      })),
      tags: tagRows.map((row) => ({
        slug: text(row.slug),
        nameZh: text(row.name_zh),
        nameEn: text(row.name_en),
        count: int(row.count),
      })),
      // zod strips the internal id/categoryId fields.
      entries: entries.map((entry) => ({
        ...entry,
        posts: media.get(entry.username)?.posts ?? [],
        memberHistory: media.get(entry.username)?.memberHistory ?? [],
        related: {
          channels: related(entry, "channel"),
          groups: related(entry, "group"),
        },
      })),
      randomShards: {
        channel: usernamesOf("channel"),
        group: usernamesOf("group"),
        bot: usernamesOf("bot"),
        all: entries.map((e) => e.username),
      },
    });

    function related(self: (typeof entries)[number], kind: EntryKind): string[] {
      const selfTags = new Set(self.tags);
      return entries
        .filter((other) => other.kind === kind && other.username !== self.username)
        .map((other) => ({
          other,
          score:
            (other.categoryId === self.categoryId ? 3 : 0) +
            other.tags.filter((tag) => selfTags.has(tag)).length,
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.other.members ?? -1) - (a.other.members ?? -1) ||
            a.other.username.localeCompare(b.other.username),
        )
        .slice(0, RELATED_LIMIT)
        .map(({ other }) => other.username);
    }
  }

  async function loadMedia(entries: { username: string; kind: EntryKind }[]) {
    const media = new Map<string, { posts: PostView[]; memberHistory: MemberPoint[] }>();
    const tasks = entries.map((entry) => async () => {
      // Only channels have public post previews.
      const posts =
        entry.kind === "channel"
          ? PostView.array().safeParse(await readMedia(`posts/${entry.username}.json`))
          : undefined;
      const history = MemberPoint.array().safeParse(
        await readMedia(`history/${entry.username}.json`),
      );
      media.set(entry.username, {
        posts: posts?.success ? posts.data : [],
        memberHistory: history.success ? history.data : [],
      });
    });

    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        if (task) await task();
      }
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
    return media;
  }

  /** Returns parsed JSON, or undefined when the object doesn't exist. */
  async function readMedia(key: string): Promise<unknown> {
    if (mediaDir) {
      try {
        return JSON.parse(await readFile(path.join(mediaDir, key), "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    }
    if (!mediaBaseUrl) return undefined;
    const url = `${mediaBaseUrl}/${key}`;
    const response = await (options.fetch ?? fetch)(url);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
    return response.json();
  }
}

const PAGE_SIZE = 60;
const LOCALES = 2;

/** Static files the web build will emit for this data (detail pages + paginated list pages, both locales). */
export function projectedStaticFileCount(data: SiteData): number {
  const pages = (count: number) => Math.max(1, Math.ceil(count / PAGE_SIZE));
  const listPages =
    pages(data.stats.channels) +
    pages(data.stats.groups) +
    pages(data.stats.bots) +
    data.categories.reduce((sum, c) => sum + pages(c.count), 0) +
    data.tags.filter((t) => t.count > 0).reduce((sum, t) => sum + pages(t.count), 0);
  return (data.entries.length + listPages) * LOCALES;
}
