import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type PostView, SiteData } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import {
  buildFixtureDb,
  type FixtureEntry,
  fixtureHistory,
  fixtureNow,
  fixturePosts,
  writeFixtureMedia,
} from "../test/fixtures/build-fixture.ts";
import { buildSiteData } from "./index.ts";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "tgbox-snapshot-"));
}

function fixtureDb() {
  return buildFixtureDb(path.join(tempDir(), "export.sqlite"));
}

function entry(data: SiteData, username: string) {
  const found = data.entries.find((e) => e.username === username);
  if (!found) throw new Error(`missing entry ${username}`);
  return found;
}

describe("buildSiteData", () => {
  test("publishes only approved entries, with stats and counts ignoring hidden ones", async () => {
    const data = await buildSiteData({ dbPath: fixtureDb(), mediaDir: tempDir(), now: fixtureNow });

    const usernames = data.entries.map((e) => e.username);
    expect(usernames).not.toContain("hiddenchan");
    expect(usernames).not.toContain("removedchan");
    expect(usernames).not.toContain("adminhidden");
    expect(usernames).toHaveLength(10);
    expect(data.stats).toEqual({ total: 10, channels: 5, groups: 3, bots: 2 });
    expect(data.categories.find((c) => c.kind === "channel" && c.slug === "tech")?.count).toBe(2);
    expect(data.categories.find((c) => c.kind === "bot" && c.slug === "search")?.count).toBe(0);
    // Icons come from D1 (seeded by migration 0004, edited in the admin).
    expect(data.categories.find((c) => c.kind === "channel" && c.slug === "tech")?.icon).toBe(
      "code",
    );
    expect(data.tags.find((t) => t.slug === "programming")?.count).toBe(4);
    expect(data.generatedAt).toBe(fixtureNow.toISOString());
    expect(SiteData.safeParse(data).success).toBe(true);
  });

  test("maps entry fields from the export", async () => {
    const data = await buildSiteData({
      dbPath: fixtureDb(),
      mediaDir: tempDir(),
      mediaBaseUrl: "https://media.example.com/",
      now: fixtureNow,
    });

    expect(entry(data, "techdaily")).toMatchObject({
      kind: "channel",
      category: "tech",
      tags: ["chinese", "programming"],
      title: "每日科技",
      lang: "zh",
      verified: false,
      avatarUrl: "https://media.example.com/avatars/techdaily.jpg?v=a1",
      members: 5000,
      activityTier: 4,
      listedAt: "2026-08-02T00:00:00.000Z",
      promo: null,
    });
    expect(entry(data, "devchat")).toMatchObject({ avatarUrl: null, online: 30 });
    expect(entry(data, "helperbot")).toMatchObject({
      members: null,
      online: null,
      activityTier: null,
    });
    // The admin's manual flag is a site-wide pin.
    expect(entry(data, "aiwatch").promo).toBe("pin");
    expect(entry(data, "worldnews").verified).toBe(true);
  });

  test("carries the machine translations of a description, null where there is none", async () => {
    const data = await buildSiteData({ dbPath: fixtureDb(), mediaDir: tempDir(), now: fixtureNow });

    expect(entry(data, "techdaily")).toMatchObject({
      description: "每天分享开发与科技新闻",
      descriptionZh: "每天分享开发与科技新闻",
      descriptionEn: "Daily development and tech news.",
    });
    expect(entry(data, "devnotes")).toMatchObject({
      description: "Notes about programming",
      descriptionZh: null,
      descriptionEn: null,
    });
  });

  test("an export taken before the translation columns existed reads them as null", async () => {
    const dbPath = fixtureDb();
    const db = new DatabaseSync(dbPath);
    db.exec("ALTER TABLE entries DROP COLUMN description_zh");
    db.exec("ALTER TABLE entries DROP COLUMN description_en");
    db.close();

    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(entry(data, "techdaily")).toMatchObject({
      description: "每天分享开发与科技新闻",
      descriptionZh: null,
      descriptionEn: null,
    });
    expect(SiteData.safeParse(data).success).toBe(true);
  });

  test("ranks related entries by same category then shared tags, ties by members", async () => {
    const data = await buildSiteData({ dbPath: fixtureDb(), mediaDir: tempDir(), now: fixtureNow });

    // devnotes: same category + 1 tag; worldnews/aiwatch: 1 tag each (20000 > 8000 members);
    // movieshare shares nothing; hidden/removed entries never appear.
    expect(entry(data, "techdaily").related).toEqual({
      channels: ["devnotes", "worldnews", "aiwatch"],
      groups: ["devchat", "chitchat"],
    });
    expect(entry(data, "movieshare").related).toEqual({ channels: [], groups: [] });
  });

  test("caps related entries at 6 per kind", async () => {
    const many: FixtureEntry[] = Array.from({ length: 9 }, (_, i) => ({
      username: `chan${i}`,
      kind: "channel",
      category: "news",
      tags: [],
      title: `Channel ${i}`,
      members: i,
      listedDaysAgo: 1,
    }));
    const dbPath = buildFixtureDb(path.join(tempDir(), "many.sqlite"), many);
    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(entry(data, "chan0").related.channels).toEqual([
      "chan8",
      "chan7",
      "chan6",
      "chan5",
      "chan4",
      "chan3",
    ]);
  });

  test("builds random-bottle shards per kind and for all", async () => {
    const data = await buildSiteData({ dbPath: fixtureDb(), mediaDir: tempDir(), now: fixtureNow });

    expect([...(data.randomShards.channel ?? [])].sort()).toEqual(
      ["aiwatch", "devnotes", "movieshare", "techdaily", "worldnews"].sort(),
    );
    expect([...(data.randomShards.group ?? [])].sort()).toEqual(["chitchat", "devchat", "vpsclub"]);
    expect([...(data.randomShards.bot ?? [])].sort()).toEqual(["gptbot", "helperbot"]);
    expect([...(data.randomShards.all ?? [])].sort()).toEqual(
      data.entries.map((e) => e.username).sort(),
    );
  });

  test("loads posts and member history from a local media directory", async () => {
    const data = await buildSiteData({
      dbPath: fixtureDb(),
      mediaDir: writeFixtureMedia(tempDir()),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts).toEqual(fixturePosts);
    expect(entry(data, "techdaily").memberHistory).toEqual(fixtureHistory);
    expect(entry(data, "devnotes")).toMatchObject({ posts: [], memberHistory: [] });
  });

  test("fetches posts for channels and history for all entries from the media URL", async () => {
    const requested: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://media.example.com/posts/techdaily.json") {
        return Response.json(fixturePosts);
      }
      if (url === "https://media.example.com/history/devchat.json") {
        return Response.json(fixtureHistory);
      }
      return new Response("not found", { status: 404 });
    };
    const data = await buildSiteData({
      dbPath: fixtureDb(),
      mediaBaseUrl: "https://media.example.com",
      fetch: fakeFetch,
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts).toEqual(fixturePosts);
    expect(entry(data, "devchat").memberHistory).toEqual(fixtureHistory);
    expect(entry(data, "devchat").posts).toEqual([]);
    expect(requested).not.toContain("https://media.example.com/posts/devchat.json");
    expect(requested).not.toContain("https://media.example.com/posts/hiddenchan.json");
  });

  test("reads a .sql dump like the one wrangler d1 export writes", async () => {
    const migrationsDir = path.resolve(import.meta.dirname, "../../db/migrations");
    const dumpPath = path.join(tempDir(), "export.sql");
    writeFileSync(
      dumpPath,
      [
        // The dump carries the current schema: every schema migration, in order (no seed rows).
        ...readdirSync(migrationsDir)
          .filter((file) => file.endsWith(".sql") && !file.includes("taxonomy"))
          .sort()
          .map((file) => readFileSync(path.join(migrationsDir, file), "utf8")),
        `INSERT INTO "categories" ("id","slug","kind","name_zh","name_en","sort") VALUES(1,'tools','bot','实用工具','Utilities',10);`,
        `INSERT INTO "entries" ("id","username","kind","category_id","title","listed_at","updated_at") VALUES(1,'dumpbot','bot',1,'导出机器人',1788220800000,1788220800000);`,
      ].join("\n"),
    );

    const data = await buildSiteData({ dbPath: dumpPath, mediaDir: tempDir(), now: fixtureNow });

    expect(data.entries.map((e) => e.username)).toEqual(["dumpbot"]);
    expect(data.stats.bots).toBe(1);
  });

  describe("payment methods a buyer can use", () => {
    const withPayments = async (payments: Record<string, unknown>) => {
      const dbPath = fixtureDb();
      const db = new DatabaseSync(dbPath);
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('payments', ?, 0)").run(
        JSON.stringify(payments),
      );
      db.close();
      return (await buildSiteData({ dbPath, now: fixtureNow })).payments;
    };

    test("a switched-off method is not advertised", async () => {
      // The Mini App reads this to decide which prices to show. Quoting Stars while Stars is off
      // puts a price on screen with no button behind it, which is what this prevents.
      expect(
        await withPayments({
          starsEnabled: false,
          usdtSelfEnabled: true,
          usdtAddress: "T".padEnd(34, "a"),
        }),
      ).toEqual({ stars: false, usdt: true });
      expect(await withPayments({ starsEnabled: true, usdtSelfEnabled: false })).toEqual({
        stars: true,
        usdt: false,
      });
    });

    test("USDT switched on without a receiving address is not usable", async () => {
      expect(
        await withPayments({ starsEnabled: false, usdtSelfEnabled: true, usdtAddress: "" }),
      ).toEqual({ stars: false, usdt: false });
    });

    test("no payments row falls back to the defaults", async () => {
      const dbPath = fixtureDb();
      expect((await buildSiteData({ dbPath, now: fixtureNow })).payments).toEqual({
        stars: true,
        usdt: false,
      });
    });

    test("the receiving address is never part of public build output", async () => {
      const address = "TTAPZZznSGph3H7k2vMAWPgPhK22zQ4Xid";
      const dbPath = fixtureDb();
      const db = new DatabaseSync(dbPath);
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('payments', ?, 0)").run(
        JSON.stringify({ usdtSelfEnabled: true, usdtAddress: address }),
      );
      db.close();
      const data = await buildSiteData({ dbPath, now: fixtureNow });
      expect(JSON.stringify(data)).not.toContain(address);
    });
  });

  test("publishes the enabled announcement, live banners and live pins", async () => {
    const dbPath = fixtureDb();
    const now = fixtureNow.getTime();
    const db = new DatabaseSync(dbPath);
    const banner = (title: string, imageUrl?: string) =>
      JSON.stringify({ title, subtitle: "副标题", href: "https://t.me/techdaily", imageUrl });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('site', ?, 0)").run(
      JSON.stringify({ announcement: { enabled: true, zh: "公告", en: "Notice", href: null } }),
    );
    const insert = db.prepare(
      "INSERT INTO promotions (id, kind, entry_username, banner, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0)",
    );
    insert.run(
      1,
      "banner",
      null,
      banner("后开始", "https://media.example.com/promos/1.jpg"),
      now - 1000,
      now + 1000,
    );
    insert.run(2, "banner", null, banner("先开始"), now - 2000, now + 1000);
    insert.run(3, "banner", null, banner("已过期"), now - 3000, now);
    insert.run(4, "banner", null, "{broken", now - 3000, now + 1000);
    insert.run(5, "pin", "devnotes", null, now - 1000, now + 1000);
    insert.run(6, "pin", "movieshare", null, now - 2000, now);
    // Several tiers on one entry: the highest wins.
    insert.run(7, "highlight", "devnotes", null, now - 1000, now + 1000);
    insert.run(8, "highlight", "techdaily", null, now - 1000, now + 1000);
    insert.run(9, "category_pin", "techdaily", null, now - 1000, now + 1000);
    insert.run(10, "announcement", null, banner("公告条"), now - 1000, now + 1000);
    // The CI export leaves out private tables such as `orders`; the snapshot must not need them.
    db.exec("DROP TABLE orders; DROP TABLE submissions; DROP TABLE blacklist;");
    db.close();

    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(data.announcement).toEqual({ zh: "公告", en: "Notice", href: null });
    expect(data.promos).toEqual([
      {
        id: "2",
        title: "先开始",
        subtitle: "副标题",
        href: "https://t.me/techdaily",
        // Banners sold before image upload existed carry no imageUrl at all.
        imageUrl: null,
        sponsored: true,
      },
      {
        id: "1",
        title: "后开始",
        subtitle: "副标题",
        href: "https://t.me/techdaily",
        imageUrl: "https://media.example.com/promos/1.jpg",
        sponsored: true,
      },
    ]);
    expect(entry(data, "devnotes").promo).toBe("pin");
    expect(entry(data, "techdaily").promo).toBe("category_pin");
    expect(entry(data, "movieshare").promo).toBeNull();
    expect(entry(data, "aiwatch").promo).toBe("pin");
    expect(data.sponsoredAnnouncements).toMatchObject([{ id: "10", title: "公告条" }]);
    // Capacity as the bot counts it; category pins publish only their per-category size.
    expect(data.inventory).toEqual(
      expect.arrayContaining([
        { kind: "banner", slots: 5, used: 3 },
        { kind: "pin", slots: 10, used: 1 },
        { kind: "highlight", slots: 30, used: 2 },
        { kind: "category_pin", slots: 3, used: null },
        { kind: "announcement", slots: 1, used: 1 },
      ]),
    );
  });

  test("an export without settings and promotions tables has no announcement or promos", async () => {
    const dbPath = fixtureDb();
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE settings; DROP TABLE promotions;");
    db.close();

    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(data).toMatchObject({ announcement: null, promos: [], sponsoredAnnouncements: [] });
    expect(entry(data, "aiwatch").promo).toBe("pin");
  });

  test("fails when the media URL returns a server error", async () => {
    const failing: typeof fetch = async () => new Response("boom", { status: 500 });
    await expect(
      buildSiteData({
        dbPath: fixtureDb(),
        mediaBaseUrl: "https://media.example.com",
        fetch: failing,
        now: fixtureNow,
      }),
    ).rejects.toThrow(/500/);
  });
});

describe("snapshot CLI", () => {
  test("writes SiteData JSON and prints counts", () => {
    const dir = tempDir();
    const out = path.join(dir, "site-data.json");
    const stdout = execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, "cli.ts"),
        "--db",
        fixtureDb(),
        "--out",
        out,
        "--media-dir",
        writeFixtureMedia(dir),
      ],
      { encoding: "utf8" },
    );

    const data = SiteData.parse(JSON.parse(readFileSync(out, "utf8")));
    expect(data.stats.total).toBe(10);
    expect(entry(data, "techdaily").posts).toEqual(fixturePosts);
    expect(stdout).toContain("10 entries");
  });
});

describe("post visibility", () => {
  const posts: PostView[] = [
    {
      id: 3,
      date: "2026-08-31T12:00:00.000Z",
      text: "正常内容",
      views: 10,
      mediaThumb: "https://media.example.com/thumbs/3.jpg",
    },
    { id: 2, date: "2026-08-30T12:00:00.000Z", text: "免费 VPN 节点", views: 5 },
    { id: 1, date: "2026-08-29T12:00:00.000Z", text: "First post", views: null },
  ];

  /** Fixture db + a media dir where `techdaily` has the posts above. */
  function fixture(prepare?: (db: DatabaseSync) => void) {
    const dir = tempDir();
    const dbPath = buildFixtureDb(path.join(dir, "export.sqlite"));
    if (prepare) {
      const db = new DatabaseSync(dbPath);
      prepare(db);
      db.close();
    }
    mkdirSync(path.join(dir, "posts"), { recursive: true });
    writeFileSync(path.join(dir, "posts/techdaily.json"), JSON.stringify(posts));
    return { dbPath, mediaDir: dir };
  }

  const siteSettings = (value: object) => (db: DatabaseSync) => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('site', ?, 0)").run(
      JSON.stringify(value),
    );
  };

  test("publishes every post when nothing is hidden", async () => {
    const data = await buildSiteData({ ...fixture(), now: fixtureNow });

    expect(entry(data, "techdaily").posts).toEqual(posts);
  });

  test("drops all posts of an entry with hide_posts", async () => {
    const data = await buildSiteData({
      ...fixture((db) => db.exec("UPDATE entries SET hide_posts = 1 WHERE username = 'techdaily'")),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts).toEqual([]);
  });

  test("drops single posts listed in hidden_posts", async () => {
    const data = await buildSiteData({
      ...fixture((db) =>
        db.exec(
          `INSERT INTO hidden_posts (entry_id, post_id, created_at)
             SELECT id, 3, 0 FROM entries WHERE username = 'techdaily'`,
        ),
      ),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts.map((post) => post.id)).toEqual([2, 1]);
  });

  test("drops posts matching the keyword blocklist, ignoring case", async () => {
    const data = await buildSiteData({
      ...fixture(siteSettings({ postBlocklist: ["vpn", "  "] })),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts.map((post) => post.id)).toEqual([3, 1]);
  });

  test("strips media thumbnails but keeps the text when hidePostMedia is on", async () => {
    const data = await buildSiteData({
      ...fixture(siteSettings({ hidePostMedia: true })),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts).toEqual(posts.map(({ mediaThumb, ...post }) => post));
    expect(entry(data, "techdaily").posts[0]?.mediaThumb).toBeUndefined();
  });

  test("an export without hidden_posts or hide_posts publishes every post", async () => {
    const data = await buildSiteData({
      ...fixture((db) =>
        db.exec("DROP TABLE hidden_posts; ALTER TABLE entries DROP COLUMN hide_posts"),
      ),
      now: fixtureNow,
    });

    expect(entry(data, "techdaily").posts).toEqual(posts);
  });
});
