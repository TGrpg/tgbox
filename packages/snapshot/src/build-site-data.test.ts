import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SiteData } from "@tgbox/shared";
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
      isPromoted: false,
    });
    expect(entry(data, "devchat")).toMatchObject({ avatarUrl: null, online: 30 });
    expect(entry(data, "helperbot")).toMatchObject({
      members: null,
      online: null,
      activityTier: null,
    });
    expect(entry(data, "aiwatch").isPromoted).toBe(true);
    expect(entry(data, "worldnews").verified).toBe(true);
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

  test("publishes the enabled announcement, live banners and live pins", async () => {
    const dbPath = fixtureDb();
    const now = fixtureNow.getTime();
    const db = new DatabaseSync(dbPath);
    const banner = (title: string) =>
      JSON.stringify({ title, subtitle: "副标题", href: "https://t.me/techdaily" });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('site', ?, 0)").run(
      JSON.stringify({ announcement: { enabled: true, zh: "公告", en: "Notice", href: null } }),
    );
    const insert = db.prepare(
      "INSERT INTO promotions (id, kind, entry_username, banner, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0)",
    );
    insert.run(1, "banner", null, banner("后开始"), now - 1000, now + 1000);
    insert.run(2, "banner", null, banner("先开始"), now - 2000, now + 1000);
    insert.run(3, "banner", null, banner("已过期"), now - 3000, now);
    insert.run(4, "banner", null, "{broken", now - 3000, now + 1000);
    insert.run(5, "pin", "devnotes", null, now - 1000, now + 1000);
    insert.run(6, "pin", "movieshare", null, now - 2000, now);
    db.close();

    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(data.announcement).toEqual({ zh: "公告", en: "Notice", href: null });
    expect(data.promos).toEqual([
      {
        id: "2",
        title: "先开始",
        subtitle: "副标题",
        href: "https://t.me/techdaily",
        sponsored: true,
      },
      {
        id: "1",
        title: "后开始",
        subtitle: "副标题",
        href: "https://t.me/techdaily",
        sponsored: true,
      },
    ]);
    expect(entry(data, "devnotes").isPromoted).toBe(true);
    expect(entry(data, "movieshare").isPromoted).toBe(false);
    expect(entry(data, "aiwatch").isPromoted).toBe(true);
  });

  test("an export without settings and promotions tables has no announcement or promos", async () => {
    const dbPath = fixtureDb();
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE settings; DROP TABLE promotions;");
    db.close();

    const data = await buildSiteData({ dbPath, mediaDir: tempDir(), now: fixtureNow });

    expect(data).toMatchObject({ announcement: null, promos: [] });
    expect(entry(data, "aiwatch").isPromoted).toBe(true);
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
