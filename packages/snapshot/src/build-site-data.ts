import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  BannerContent,
  EntryKind,
  type EntryProductKind,
  isEntryProduct,
  MemberPoint,
  PaymentSettings,
  PostView,
  ProductKind,
  SiteData,
  SiteSettings,
  settingsDefaults,
  shouldHidePost,
} from "@tgbox/shared";

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

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function jsonOrNull(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    const nowMs = now.getTime();
    // Exports taken before migration 0005 have no settings/promotions tables, ones taken before
    // 0006 have no hidden_posts table or entries.hide_posts column, and ones before 0009 have no
    // description_zh/description_en columns.
    const hasTable = (name: string) =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
      undefined;
    const hasColumn = (table: string, column: string) =>
      db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column) !==
      undefined;
    const hasPromotions = hasTable("promotions");
    const translationColumns = hasColumn("entries", "description_zh")
      ? "e.description_zh, e.description_en"
      : "NULL AS description_zh, NULL AS description_en";

    const rows = db
      .prepare(
        `SELECT e.id, e.username, e.kind, e.category_id, c.slug AS category, e.title, e.description,
           ${translationColumns},
           e.lang, e.verified, e.avatar_version, e.tg_created_at, e.listed_at, e.updated_at,
           e.is_promoted,
           s.members, s.online, s.activity_tier
         FROM entries e
         JOIN categories c ON c.id = e.category_id
         LEFT JOIN entry_stats s ON s.entry_id = e.id
         WHERE e.status = 'approved'
         ORDER BY e.listed_at DESC, e.username`,
      )
      .all();

    // Highest live entry promotion per username; the admin's manual flag counts as a site pin.
    const tierRank = { highlight: 1, category_pin: 2, pin: 3 } as const;
    const promoByUsername = new Map<string, EntryProductKind>();
    if (hasPromotions) {
      for (const row of db
        .prepare(
          "SELECT entry_username, kind FROM promotions WHERE ends_at > ? AND entry_username IS NOT NULL",
        )
        .all(nowMs)) {
        const kind = ProductKind.safeParse(row.kind);
        if (!kind.success || !isEntryProduct(kind.data)) continue;
        const username = text(row.entry_username);
        const current = promoByUsername.get(username);
        if (!current || tierRank[kind.data] > tierRank[current]) {
          promoByUsername.set(username, kind.data);
        }
      }
    }

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

    // Post visibility, set by the operator in the admin: whole entry, or single posts.
    const entriesHidingPosts = new Set(
      hasColumn("entries", "hide_posts")
        ? db
            .prepare("SELECT id FROM entries WHERE hide_posts = 1")
            .all()
            .map((row) => int(row.id))
        : [],
    );
    const hiddenPostsByEntry = new Map<number, Set<number>>();
    if (hasTable("hidden_posts")) {
      for (const row of db.prepare("SELECT entry_id, post_id FROM hidden_posts").all()) {
        const id = int(row.entry_id);
        const ids = hiddenPostsByEntry.get(id) ?? new Set<number>();
        ids.add(int(row.post_id));
        hiddenPostsByEntry.set(id, ids);
      }
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
        descriptionZh: textOrNull(row.description_zh),
        descriptionEn: textOrNull(row.description_en),
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
        updatedAt: new Date(int(row.updated_at)).toISOString(),
        promo: int(row.is_promoted) === 1 ? "pin" : (promoByUsername.get(username) ?? null),
      };
    });

    const media = await loadMedia(entries);

    const categoryRows = db
      .prepare(
        `SELECT c.id, c.slug, c.kind, c.name_zh, c.name_en, c.sort, c.icon,
           (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id AND e.status = 'approved') AS count
         FROM categories c ORDER BY c.kind, c.sort, c.slug`,
      )
      .all();
    const tagRows = db
      .prepare(
        `SELECT t.id, t.slug, t.name_zh, t.name_en,
           (SELECT COUNT(*) FROM entry_tags et JOIN entries e ON e.id = et.entry_id
             WHERE et.tag_id = t.id AND e.status = 'approved') AS count
         FROM tags t ORDER BY t.slug`,
      )
      .all();

    // Brand ads live at build time, oldest first: banners for the sponsor cards, and the paid
    // announcement bar (one slot; the oldest wins should the admin have created two by hand).
    const liveAds = (kind: "banner" | "announcement") =>
      hasPromotions
        ? db
            .prepare(
              "SELECT id, banner FROM promotions WHERE kind = ? AND ends_at > ? ORDER BY starts_at, id",
            )
            .all(kind, nowMs)
            .flatMap((row) => {
              const banner = BannerContent.safeParse(jsonOrNull(row.banner));
              return banner.success
                ? [
                    {
                      id: String(int(row.id)),
                      ...banner.data,
                      // Banners sold before image upload existed have no imageUrl at all.
                      imageUrl: banner.data.imageUrl ?? null,
                      sponsored: true,
                    },
                  ]
                : [];
            })
        : [];
    const promos = liveAds("banner");
    const sponsoredAnnouncement = liveAds("announcement")[0] ?? null;

    // Capacity per kind for the advertising page: live promotions only, since `orders` (buyer ids)
    // is never exported. Category pins are per category, so only their size is published.
    const inventory =
      hasPromotions && hasTable("products")
        ? db
            .prepare(
              `SELECT p.kind, MAX(p.slots) AS slots,
               (SELECT COUNT(*) FROM promotions pr WHERE pr.kind = p.kind AND pr.ends_at > ?) AS used
             FROM products p WHERE p.active = 1 GROUP BY p.kind`,
            )
            .all(nowMs)
            .flatMap((row) => {
              const kind = ProductKind.safeParse(row.kind);
              if (!kind.success) return [];
              const used = kind.data === "category_pin" ? null : int(row.used);
              return [{ kind: kind.data, slots: int(row.slots), used }];
            })
        : [];

    // The Mini App's purchase screen reads the price list as a static file, so it never
    // costs a Worker request; the build is dispatched whenever the admin edits a product.
    const productRows = hasTable("products")
      ? db
          .prepare(
            "SELECT id, kind, name_zh, name_en, days, price_stars, price_usdt FROM products WHERE active = 1 ORDER BY sort, id",
          )
          .all()
      : [];

    const siteRow = hasTable("settings")
      ? db.prepare("SELECT value FROM settings WHERE key = 'site'").get()
      : undefined;
    const paymentsRow = hasTable("settings")
      ? db.prepare("SELECT value FROM settings WHERE key = 'payments'").get()
      : undefined;
    // Merge over the defaults so a row stored before a field existed keeps the rest of its values.
    const stored = jsonOrNull(siteRow?.value ?? null);
    const parsed = SiteSettings.safeParse(
      typeof stored === "object" && stored !== null
        ? { ...settingsDefaults.site, ...stored }
        : stored,
    );
    const site = parsed.success ? parsed.data : settingsDefaults.site;
    const announcement = site.announcement.enabled
      ? { zh: site.announcement.zh, en: site.announcement.en, href: site.announcement.href }
      : null;

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
        id: int(row.id),
        slug: text(row.slug),
        kind: EntryKind.parse(row.kind),
        nameZh: text(row.name_zh),
        nameEn: text(row.name_en),
        sort: int(row.sort),
        icon: row.icon === null ? null : text(row.icon),
        count: int(row.count),
      })),
      tags: tagRows.map((row) => ({
        id: int(row.id),
        slug: text(row.slug),
        nameZh: text(row.name_zh),
        nameEn: text(row.name_en),
        count: int(row.count),
      })),
      // zod strips the internal id/categoryId fields.
      entries: entries.map((entry) => ({
        ...entry,
        posts: visiblePosts(entry),
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
      announcement,
      promos,
      sponsoredAnnouncement,
      inventory,
      showAdSlots: site.showAdSlots,
      payments: paymentMethods(),
      products: productRows.map((row) => ({
        id: int(row.id),
        kind: text(row.kind),
        nameZh: text(row.name_zh),
        nameEn: text(row.name_en),
        days: int(row.days),
        priceStars: int(row.price_stars),
        priceUsdt: text(row.price_usdt),
      })),
    });

    /**
     * The two flags a buyer can see, derived the same way the bot derives its payment buttons:
     * a method counts as usable only if it is switched on *and* configured. Crypto Pay needs a
     * token we can't see from here, so it is reported as USDT only when the self-hosted address
     * is set — a buyer is never shown a price they cannot pay.
     */
    function paymentMethods(): { stars: boolean; usdt: boolean } {
      const stored = jsonOrNull(paymentsRow?.value ?? null);
      const parsed = PaymentSettings.safeParse(
        typeof stored === "object" && stored !== null
          ? { ...settingsDefaults.payments, ...stored }
          : stored,
      );
      const payments = parsed.success ? parsed.data : settingsDefaults.payments;
      return {
        stars: payments.starsEnabled,
        usdt: payments.usdtSelfEnabled && payments.usdtAddress !== "",
      };
    }

    /** Applies the operator's post filters: whole entry, single posts, keywords, media. */
    function visiblePosts(entry: (typeof entries)[number]): PostView[] {
      if (entriesHidingPosts.has(entry.id)) return [];
      const hidden = hiddenPostsByEntry.get(entry.id);
      return (media.get(entry.username)?.posts ?? [])
        .filter((post) => !hidden?.has(post.id))
        .filter((post) => !shouldHidePost(post.text, site.postBlocklist))
        .map((post) => {
          if (!site.hidePostMedia) return post;
          const { mediaThumb, ...rest } = post;
          return rest;
        });
    }

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
