import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildSiteData } from "../../../packages/snapshot/src/index.ts";
import {
  buildFixtureDb,
  type FixtureEntry,
  fixtureEntries,
  fixtureNow,
  writeFixtureMedia,
} from "../../../packages/snapshot/test/fixtures/build-fixture.ts";

// Seam B: fixture SQLite → snapshot → `astro build` → assert on the generated files.
const webRoot = path.resolve(import.meta.dirname, "..");
const siteUrl = "https://nav.example.org";
const mediaBaseUrl = "https://media.example.org";
const work = mkdtempSync(path.join(tmpdir(), "tgbox-web-build-"));
// Node prerendering imports externalized deps from the output, so it must resolve apps/web/node_modules.
mkdirSync(path.join(webRoot, "node_modules/.cache"), { recursive: true });
const outDir = mkdtempSync(path.join(webRoot, "node_modules/.cache/build-test-"));
const client = path.join(outDir, "client");

// 61 approved channels in one category → two listing pages (60 per page).
const gameChannels: FixtureEntry[] = Array.from({ length: 61 }, (_, index) => ({
  username: `gamechan${String(index).padStart(2, "0")}`,
  kind: "channel",
  category: "games",
  tags: [],
  title: `Game Channel ${index}`,
  members: 1000 - index,
  listedDaysAgo: 60,
}));

const announcement = {
  zh: "春季推广位开放预订",
  en: "Spring promo slots are open",
  href: "https://t.me/tgbox_support",
};
const paidPromo = {
  id: "41",
  title: "Rocket <VPN> & Proxy",
  subtitle: "Fast nodes worldwide",
  href: "https://t.me/rocketvpn",
  sponsored: true as const,
};

const approved = fixtureEntries.filter((entry) => (entry.status ?? "approved") === "approved");
const hidden = fixtureEntries.filter((entry) => (entry.status ?? "approved") !== "approved");

function html(route: string) {
  return readFileSync(path.join(client, route, "index.html"), "utf8");
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => path.join(item.parentPath, item.name));
}

function jsonLd(page: string): unknown[] {
  return [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) =>
    JSON.parse(match[1] ?? ""),
  );
}

beforeAll(async () => {
  const dbPath = buildFixtureDb(path.join(work, "export.sqlite"), [
    ...fixtureEntries,
    ...gameChannels,
  ]);
  const data = await buildSiteData({
    dbPath,
    mediaBaseUrl,
    mediaDir: writeFixtureMedia(path.join(work, "media")),
    now: fixtureNow,
  });
  // Admin-managed content is layered on here; "aiwatch" is the fixture's promoted entry.
  data.announcement = announcement;
  data.promos = [paidPromo];
  const dataPath = path.join(work, "site-data.json");
  writeFileSync(dataPath, JSON.stringify(data));
  execFileSync(path.join(webRoot, "node_modules/.bin/astro"), ["build", "--outDir", outDir], {
    cwd: webRoot,
    env: { ...process.env, SITE_DATA_PATH: dataPath, SITE_URL: siteUrl },
    stdio: "pipe",
  });
}, 180_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe("site build from snapshot data", () => {
  test.each(approved)("zh + en detail pages exist for $username", (entry) => {
    for (const prefix of ["", "en/"]) {
      const page = html(`${prefix}detail/${entry.username}`);
      expect(page).toContain(entry.title);
      if (entry.description) expect(page).toContain(entry.description);
      if (entry.members !== undefined) expect(page).toContain(entry.members.toLocaleString("en"));
    }
  });

  test("channel detail shows recent posts, stats and related entries", () => {
    const zh = html("detail/techdaily");
    expect(zh).toContain("第二条消息");
    expect(zh).toContain("First post");
    expect(zh).toContain("1,200");
    expect(zh).toContain("https://t.me/s/techdaily");
    expect(zh).toContain('href="/go/?u=techdaily"');
    expect(zh).toContain("tg://resolve?domain=techdaily");
    expect(zh).toContain(`${mediaBaseUrl}/avatars/techdaily.jpg?v=a1`);
    // member history area chart
    expect(zh).toMatch(/<svg[^>]*data-sparkline/);
    // back link to the category, go/copy/QR actions and the sticky mini header
    expect(zh).toContain("返回频道导航");
    expect(zh).toMatch(/data-copy="[^"]*\/detail\/techdaily\/"/);
    expect(zh).toMatch(/<button[^>]*data-share-open[^>]*aria-label="二维码"/);
    expect(zh).toContain("data-detail-sticky");
    expect(zh).toContain("相关频道推荐");
    expect(html("en/detail/techdaily")).toContain("Back to Channels");
    // related channel devnotes shares the category
    expect(zh).toContain('href="/detail/devnotes/"');
    expect(html("en/detail/techdaily")).toContain('href="/en/detail/devnotes/"');
  });

  test("hidden and removed entries are absent from pages and sitemaps", () => {
    for (const entry of hidden) {
      expect(existsSync(path.join(client, "detail", entry.username))).toBe(false);
      expect(existsSync(path.join(client, "en/detail", entry.username))).toBe(false);
    }
    const textFiles = allFiles(client).filter((file) => /\.(html|xml|json)$/.test(file));
    for (const file of textFiles) {
      const content = readFileSync(file, "utf8");
      for (const entry of hidden) expect(content, file).not.toContain(entry.username);
    }
  });

  test("detail pages have canonical, hreflang alternates and parseable JSON-LD", () => {
    const zh = html("detail/devnotes");
    const en = html("en/detail/devnotes");
    expect(zh).toContain(`<link rel="canonical" href="${siteUrl}/detail/devnotes/">`);
    expect(en).toContain(`<link rel="canonical" href="${siteUrl}/en/detail/devnotes/">`);
    for (const page of [zh, en]) {
      expect(page).toContain(
        `<link rel="alternate" hreflang="zh-CN" href="${siteUrl}/detail/devnotes/">`,
      );
      expect(page).toContain(
        `<link rel="alternate" hreflang="en" href="${siteUrl}/en/detail/devnotes/">`,
      );
    }
    const types = jsonLd(zh).map((item) =>
      typeof item === "object" && item && "@type" in item ? item["@type"] : null,
    );
    expect(types).toContain("WebPage");
    expect(types).toContain("BreadcrumbList");
    expect(JSON.stringify(jsonLd(zh))).toContain('"userInteractionCount":3000');
  });

  test("detail pages load only the shared motion module, the sticky bar module and no page-specific islands", () => {
    const modulesSeen = new Set<string>();
    for (const entry of approved) {
      const page = html(`detail/${entry.username}`);
      const modules = [...page.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      expect(modules).toHaveLength(2);
      expect(page.match(/<script[^>]*type="module"/g)).toHaveLength(2);
      for (const module of modules) modulesSeen.add(module);
      // The header search dialog is the only React island allowed on detail pages.
      const islands = [...page.matchAll(/<astro-island[^>]*component-url="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      expect(islands).toHaveLength(1);
      expect(islands[0]).toMatch(/SearchDialog/);
    }
    expect(modulesSeen.size).toBe(2);
    // Each entry module plus the chunks it statically imports (Motion is shared between them).
    const withImports = (module: string): string[] => {
      const source = readFileSync(path.join(client, module), "utf8");
      const imports = [...source.matchAll(/from\s*"\.\/([^"]+)"/g)].map(
        (match) => `${path.posix.dirname(module)}/${match[1] ?? ""}`,
      );
      return [module, ...imports.flatMap(withImports)];
    };
    const gzipped = (files: string[]) =>
      gzipSync(
        Buffer.concat([...new Set(files)].map((file) => readFileSync(path.join(client, file)))),
      ).length;
    const [motionModule = ""] = [...modulesSeen].filter(
      (module) => !/DetailStickyBar/.test(module),
    );
    const [stickyModule = ""] = [...modulesSeen].filter((module) => /DetailStickyBar/.test(module));
    const motionFiles = withImports(motionModule);
    for (const file of [...motionFiles, ...withImports(stickyModule)]) {
      expect(readFileSync(path.join(client, file), "utf8")).not.toMatch(/react/i);
    }
    expect(gzipped(motionFiles)).toBeLessThan(6 * 1024);
    // The sticky bar reuses the shared Motion chunk, so it only adds its own few hundred bytes.
    expect(gzipSync(readFileSync(path.join(client, stickyModule))).length).toBeLessThan(1024);
  });

  test("home page has search hero, hot columns backed by JSON pools, latest and CTA", () => {
    for (const prefix of ["", "en/"]) {
      const page = html(prefix);
      // Hero search bar opens the header search dialog.
      expect(page.match(/data-search-trigger/g)?.length).toBeGreaterThanOrEqual(2);
      expect(page).toContain(`href="/${prefix}channel/games/"`);
      expect(page).toContain("data-home-promos");
      for (const kind of ["channel", "group", "bot"])
        expect(page).toContain(`data-home-hot="${kind}"`);
      expect(page).toContain(`href="/${prefix}detail/techdaily/"`);
      expect(page).toContain("data-count-up");
    }
    const zh = html("");
    // Rows rank by members: 10 visible channel rows, the rest reachable through the shuffle pool.
    const channelColumn = zh.split('data-home-hot="channel"')[1]?.split("data-home-hot=")[0] ?? "";
    expect(channelColumn.match(/<li/g)?.length).toBeGreaterThanOrEqual(10);
    expect(channelColumn).toContain("data-hot-shuffle");
    const pool: unknown = JSON.parse(
      readFileSync(path.join(client, "data/hot-channel.json"), "utf8"),
    );
    expect(Array.isArray(pool) && pool.length).toBe(50);
    expect(JSON.stringify(pool)).not.toContain('"u":"hiddenchan"');
    for (const kind of ["group", "bot"]) {
      expect(existsSync(path.join(client, `data/hot-${kind}.json`)), kind).toBe(true);
    }
  });

  test("announcement bar shows the snapshot announcement in each locale", () => {
    const zh = html("");
    const en = html("en/");
    expect(zh).toContain(announcement.zh);
    expect(en).toContain(announcement.en);
    expect(en).not.toContain(announcement.zh);
    const bar = zh.split("data-announcement")[1]?.split("data-announcement-dismiss")[0] ?? "";
    expect(bar).toMatch(/href="https:\/\/t\.me\/tgbox_support"[^>]*target="_blank"/);
    expect(zh).toMatch(/dismissKey = "announcement:[0-9a-z]+"/);
  });

  test("paid banners lead the home and detail promos with an ad badge and sponsored links", () => {
    for (const [route, label, cards] of [
      ["", "广告", 5],
      ["en/", "Ad", 5],
      ["detail/techdaily", "广告", 3],
    ] as const) {
      const page = html(route);
      const start = page.search(/<section[^>]*data-home-promos|<aside[^>]*aria-label="推广"/);
      const promos = page.slice(start).split(/<\/section>|<\/aside>/)[0] ?? "";
      const links = [...promos.matchAll(/<a\s[^>]*>/g)].map((match) => match[0]);
      expect(links, route).toHaveLength(cards);
      expect(links[0]).toContain(`href="${paidPromo.href}"`);
      expect(links[0]).toContain('rel="sponsored noopener"');
      expect(links[0]).toContain('target="_blank"');
      expect(promos).toContain(`>${label}<`);
      expect(promos).toContain("Rocket &lt;VPN&gt; &amp; Proxy");
    }
    // Dismissing the lineup is keyed by every card id, the paid banner included.
    expect(html("")).toMatch(/storageKey = "home-promos:41,enroll-bot,/);
  });

  test("promoted entries lead listings and hot columns with a promoted badge", () => {
    const ai = html("channel/ai");
    expect(ai).toMatch(/data-entry-card="aiwatch"[\s\S]*?data-promoted-badge[\s\S]*?推广/);
    const home = html("");
    const channelColumn =
      home.split('data-home-hot="channel"')[1]?.split("data-home-hot=")[0] ?? "";
    expect(channelColumn.match(/data-entry-row="([^"]+)"/)?.[1]).toBe("aiwatch");
    const pool: unknown = JSON.parse(
      readFileSync(path.join(client, "data/hot-channel.json"), "utf8"),
    );
    expect(Array.isArray(pool) && pool[0]).toMatchObject({ u: "aiwatch", p: true });
    expect(html("channel/tech")).not.toContain("data-promoted-badge");
  });

  test("kind, category and tag listing pages exist in both locales", () => {
    for (const route of [
      "",
      "channel",
      "group",
      "bot",
      "channel/tech",
      "group/vps",
      "bot/ai",
      "tag/programming",
    ]) {
      expect(existsSync(path.join(client, route, "index.html")), route).toBe(true);
      expect(existsSync(path.join(client, "en", route, "index.html")), `en/${route}`).toBe(true);
    }
    const tech = html("channel/tech");
    expect(tech).toContain('href="/detail/techdaily/"');
    expect(tech).toContain('href="/detail/devnotes/"');
    expect(tech).not.toContain('href="/detail/worldnews/"');
    // 2 approved channels in tech fit on one page
    expect(existsSync(path.join(client, "channel/tech/2"))).toBe(false);
    // Kind index links each non-empty category and its entries.
    const channels = html("channel");
    expect(channels).toContain('href="/channel/tech/"');
    expect(channels).toContain('href="/detail/techdaily/"');
    // Sort tabs link both prerendered orders; the "latest" order is not indexed.
    expect(tech).toContain('href="/channel/tech/latest/"');
    for (const prefix of ["", "en/"]) {
      const latest = html(`${prefix}channel/tech/latest`);
      // devnotes was listed after techdaily
      expect(latest.indexOf(`/${prefix}detail/devnotes/`)).toBeLessThan(
        latest.indexOf(`/${prefix}detail/techdaily/`),
      );
      expect(latest).toContain('<meta name="robots" content="noindex, follow">');
    }
  });

  test("every internal link on every page points to a built file", () => {
    const pages = allFiles(client).filter((file) => file.endsWith(".html"));
    const missing = new Set<string>();
    for (const file of pages) {
      // <template> rows are filled in by scripts, so their placeholder links are not real targets.
      const page = readFileSync(file, "utf8").replace(/<template[\s\S]*?<\/template>/g, "");
      for (const [, href = ""] of page.matchAll(/\shref="(\/(?!\/)[^"]*)"/g)) {
        const target = href.split(/[?#]/)[0] ?? "";
        if (/^\/(go|pagefind|data)\//.test(target)) continue;
        const resolved = path.join(client, target.endsWith("/") ? `${target}index.html` : target);
        if (!existsSync(resolved)) missing.add(`${path.relative(client, file)} → ${href}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test("category sidebar links non-empty categories only and shows counts", () => {
    const tech = html("channel/tech");
    const sidebar = tech.split('class="category-sidebar')[1]?.split("</aside>")[0] ?? "";
    expect(sidebar).toContain('href="/channel/"');
    expect(sidebar).toContain('href="/channel/tech/"');
    // A channel category without approved entries is shown but not linked.
    expect(sidebar).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-sidebar-empty/);
  });

  test("category listings paginate at 60 entries", () => {
    for (const prefix of ["", "en/"]) {
      const first = html(`${prefix}channel/games`);
      const second = html(`${prefix}channel/games/2`);
      expect(first).toContain(`href="/${prefix}detail/gamechan00/"`);
      expect(first).not.toContain(`href="/${prefix}detail/gamechan60/"`);
      expect(second).toContain(`href="/${prefix}detail/gamechan60/"`);
      expect(second).toContain(`href="/${prefix}channel/games/"`);
    }
    expect(existsSync(path.join(client, "channel/games/3"))).toBe(false);
    expect(existsSync(path.join(client, "channel/games/latest/2/index.html"))).toBe(true);
    const sitemap = readFileSync(path.join(client, "sitemap-channel-zh.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${siteUrl}/channel/games/2/</loc>`);
  });

  test("sitemap index lists sharded sitemaps with hreflang alternates", () => {
    const index = readFileSync(path.join(client, "sitemap-index.xml"), "utf8");
    for (const shard of ["pages", "channel-zh", "channel-en", "group-zh", "bot-en"]) {
      expect(index).toContain(`${siteUrl}/sitemap-${shard}.xml`);
    }
    const channelsZh = readFileSync(path.join(client, "sitemap-channel-zh.xml"), "utf8");
    expect(channelsZh).toContain(`<loc>${siteUrl}/detail/techdaily/</loc>`);
    expect(channelsZh).toContain(
      `<xhtml:link rel="alternate" hreflang="en" href="${siteUrl}/en/detail/techdaily/"/>`,
    );
    expect(channelsZh).not.toContain("/detail/devchat/");
    const channelsEn = readFileSync(path.join(client, "sitemap-channel-en.xml"), "utf8");
    expect(channelsEn).toContain(`<loc>${siteUrl}/en/detail/techdaily/</loc>`);
  });
});
