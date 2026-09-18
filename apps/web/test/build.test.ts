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
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { RankingsData } from "@tgbox/shared";
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
const promoImage = `${mediaBaseUrl}/promos/41.jpg`;
const paidPromo = {
  id: "41",
  title: "Rocket <VPN> & Proxy",
  subtitle: "Fast nodes worldwide",
  href: "https://t.me/rocketvpn",
  imageUrl: promoImage,
  sponsored: true as const,
};
const repoUrl = "https://github.com/TGrpg/tgbox";
// techdaily's own content was last edited well after it was listed, so its sitemap lastmod
// has to differ from both its listing date and the snapshot's build time.
const techdailyUpdatedAt = "2026-08-28T00:00:00.000Z";

// devnotes has posts in R2, but the operator turned them off for that entry.
const hiddenPosts = [{ id: 7, date: "2026-08-29T12:00:00.000Z", text: "被隐藏的消息", views: 9 }];

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

function types(page: string): unknown[] {
  return jsonLd(page).map((item) =>
    typeof item === "object" && item !== null && "@type" in item ? item["@type"] : null,
  );
}

function jsonLd(page: string): unknown[] {
  return [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) =>
    JSON.parse(match[1] ?? ""),
  );
}

// Shared with the ad-slots-off build below, which re-exports the same fixture database.
let dbPath = "";
let mediaDir = "";

beforeAll(async () => {
  dbPath = buildFixtureDb(path.join(work, "export.sqlite"), [...fixtureEntries, ...gameChannels]);
  mediaDir = writeFixtureMedia(path.join(work, "media"));
  // devnotes (3,000 members now) grew over the last week and month; techdaily is flat week over week.
  writeFileSync(
    path.join(mediaDir, "history/devnotes.json"),
    JSON.stringify([
      { t: "2026-07-28T00:00:00.000Z", members: 2000 },
      { t: "2026-08-18T00:00:00.000Z", members: 2500 },
      { t: "2026-08-25T00:00:00.000Z", members: 2900 },
    ]),
  );
  writeFileSync(path.join(mediaDir, "posts/devnotes.json"), JSON.stringify(hiddenPosts));
  const db = new DatabaseSync(dbPath);
  db.exec("UPDATE entries SET hide_posts = 1 WHERE username = 'devnotes'");
  db.exec(
    `UPDATE entries SET updated_at = ${Date.parse(techdailyUpdatedAt)} WHERE username = 'techdaily'`,
  );
  db.close();
  const data = await buildSiteData({
    dbPath,
    mediaBaseUrl,
    mediaDir,
    now: fixtureNow,
  });
  // Admin-managed content is layered on here; "aiwatch" is the fixture's promoted entry.
  data.announcement = announcement;
  data.promos = [paidPromo];
  // The main build asserts the ad slots as an operator who turned them on would see them; the
  // default-off behaviour gets its own build below.
  data.showAdSlots = true;
  const dataPath = path.join(work, "site-data.json");
  writeFileSync(dataPath, JSON.stringify(data));
  execFileSync(path.join(webRoot, "node_modules/.bin/astro"), ["build", "--outDir", outDir], {
    cwd: webRoot,
    env: { ...process.env, SITE_DATA_PATH: dataPath, SITE_URL: siteUrl },
    stdio: "pipe",
  });
}, 180_000);

const cleanup: string[] = [];

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

/**
 * The operator turning the sponsor block off is the one case the main build can't cover, because
 * it is baked in at build time. It gets a second, smaller build: `showAdSlots: false` with no paid
 * banners at all, which is the state the live site was actually in when the block still rendered.
 */
describe("sponsor block with ad slots off", () => {
  let offClient = "";

  beforeAll(async () => {
    const offOut = mkdtempSync(path.join(webRoot, "node_modules/.cache/build-test-noads-"));
    offClient = path.join(offOut, "client");
    const data = await buildSiteData({ dbPath, mediaBaseUrl, mediaDir, now: fixtureNow });
    data.promos = [];
    data.showAdSlots = false;
    // A paid announcement bar replaces the admin's for as long as it runs.
    data.sponsoredAnnouncement = { ...paidPromo, id: "52", imageUrl: null };
    const offDataPath = path.join(work, "site-data-noads.json");
    writeFileSync(offDataPath, JSON.stringify(data));
    execFileSync(path.join(webRoot, "node_modules/.bin/astro"), ["build", "--outDir", offOut], {
      cwd: webRoot,
      env: { ...process.env, SITE_DATA_PATH: offDataPath, SITE_URL: siteUrl },
      stdio: "pipe",
    });
    cleanup.push(offOut);
  }, 180_000);

  const page = (route: string) => readFileSync(path.join(offClient, route, "index.html"), "utf8");

  test("the whole sponsor section is gone from the home page", () => {
    const home = page(".");
    expect(home).not.toContain("赞助商推广");
    expect(home).not.toContain("广告位招租");
    expect(home).not.toContain("data-home-promos");
    expect(page("en")).not.toContain("Sponsored");
  });

  test("detail pages drop it too", () => {
    expect(page("detail/techdaily")).not.toContain("广告位招租");
    expect(page("detail/techdaily")).not.toContain("data-promo-slot");
  });

  test("a paid announcement bar is labelled, counted and marked sponsored on every page", () => {
    for (const [route, label] of [
      [".", "推广"],
      ["en", "Promoted"],
    ] as const) {
      const bar = page(route).split("data-announcement")[1]?.split("</div>")[0] ?? "";
      expect(bar, route).toContain(label);
      expect(bar, route).toContain("Rocket &lt;VPN&gt; &amp; Proxy · Fast nodes worldwide");
    }
    const link = page("en").match(/<a[^>]*href="\/r\/52"[^>]*>/)?.[0] ?? "";
    expect(link).toContain('rel="sponsored noopener"');
  });

  test("the rest of the page still renders", () => {
    expect(page(".")).toContain("techdaily");
  });
});

describe("site build from snapshot data", () => {
  test.each(approved)("zh + en detail pages exist for $username", (entry) => {
    for (const [prefix, description] of [
      ["", entry.descriptionZh ?? entry.description],
      ["en/", entry.descriptionEn ?? entry.description],
    ] as const) {
      const page = html(`${prefix}detail/${entry.username}`);
      expect(page).toContain(entry.title);
      if (description) expect(page).toContain(description);
      if (entry.members !== undefined) expect(page).toContain(entry.members.toLocaleString("en"));
    }
  });

  test("each locale reads its own translated description, or the original when there is none", () => {
    // techdaily is written in Chinese and has an English translation.
    const zh = html("detail/techdaily");
    const en = html("en/detail/techdaily");
    expect(zh).toContain("每天分享开发与科技新闻");
    expect(zh).not.toContain("自动翻译");
    expect(en).toContain("Daily development and tech news.");
    expect(en).toContain("Auto-translated");
    expect(en).toMatch(/data-auto-translated/);
    // devnotes has no translation at all, so both locales show the original text and no hint.
    for (const route of ["detail/devnotes", "en/detail/devnotes"]) {
      expect(html(route), route).toContain("Notes about programming");
      expect(html(route), route).not.toContain("data-auto-translated");
    }
  });

  test("detail pages open with an H1 and a sentence naming the entry, kind and category", () => {
    const zh = html("detail/techdaily");
    expect(zh).toMatch(/<h1[\s\S]*?每日科技[\s\S]*?Telegram 开发编程频道[\s\S]*?<\/h1>/);
    expect(zh).toMatch(
      /data-entry-summary[^>]*>\s*每日科技（@techdaily）是 TGbox 收录的 Telegram 开发编程频道，目前有 5,000 名订阅者/,
    );
    const en = html("en/detail/techdaily");
    expect(en).toMatch(/<h1[\s\S]*?Telegram Development Channel[\s\S]*?<\/h1>/);
    expect(en).toMatch(
      /data-entry-summary[^>]*>\s*每日科技 \(@techdaily\) is a Telegram Development channel listed on TGbox, with 5,000 subscribers/,
    );
    // The same sentence leads the meta description.
    expect(en).toMatch(/<meta name="description" content="每日科技 \(@techdaily\) is a Telegram/);
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

  test("a channel with hidden posts renders no posts section", () => {
    for (const [route, heading] of [
      ["detail/devnotes", "最近消息"],
      ["en/detail/devnotes", "Recent posts"],
    ] as const) {
      const page = html(route);
      expect(page, route).not.toContain(heading);
      expect(page, route).not.toContain(hiddenPosts[0]?.text ?? "");
      expect(page, route).not.toContain("https://t.me/s/devnotes");
      // The rest of the page is unaffected.
      expect(page, route).toContain("Dev Notes");
      expect(page, route).toMatch(/<svg[^>]*data-sparkline/);
      expect(page, route).toContain("data-detail-sticky");
    }
    expect(html("detail/techdaily")).toContain("最近消息");
    expect(html("en/detail/techdaily")).toContain("Recent posts");
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
    expect(types(zh)).toEqual(["WebPage", "BreadcrumbList"]);
    expect(JSON.stringify(jsonLd(zh))).toContain('"userInteractionCount":3000');
  });

  test("every page type emits parseable JSON-LD for what it actually shows", () => {
    for (const prefix of ["", "en/"]) {
      // Home: the site entity plus the Organization every other page's publisher points at.
      const home = jsonLd(html(prefix));
      expect(types(html(prefix))).toEqual(["Organization", "WebSite"]);
      const [organization, website] = home as Record<string, unknown>[];
      expect(organization).toMatchObject({
        "@id": `${siteUrl}/#organization`,
        url: `${siteUrl}/`,
        sameAs: [repoUrl, "https://t.me/tgboxccbot"],
      });
      expect(website).toMatchObject({
        url: `${siteUrl}/${prefix}`,
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/${prefix}?q={search_term_string}`,
          },
        },
      });

      // Category: the entries rendered on the page, plus the trail the breadcrumb nav describes.
      const category = html(`${prefix}channel/tech`);
      expect(types(category)).toEqual(["ItemList", "BreadcrumbList"]);
      const [list, breadcrumb] = jsonLd(category) as Record<string, unknown>[];
      expect(breadcrumb?.itemListElement).toMatchObject([
        { position: 1, item: `${siteUrl}/${prefix}` },
        { position: 2, item: `${siteUrl}/${prefix}channel/` },
        { position: 3 },
      ]);
      expect(list).toMatchObject({
        numberOfItems: 2,
        itemListElement: [
          { position: 1, name: "每日科技", url: `${siteUrl}/${prefix}detail/techdaily/` },
          { position: 2, name: "Dev Notes", url: `${siteUrl}/${prefix}detail/devnotes/` },
        ],
      });

      expect(types(html(`${prefix}channel`))).toEqual(["BreadcrumbList"]);
      expect(types(html(`${prefix}rank`))).toEqual(["ItemList", "BreadcrumbList"]);
      expect(types(html(`${prefix}tag/programming`))).toEqual(["ItemList", "BreadcrumbList"]);
      expect(types(html(`${prefix}about`))).toEqual(["FAQPage", "BreadcrumbList"]);
    }
  });

  test("listing and detail pages carry keyword meta aimed at their own page type", () => {
    const keywords = (page: string) =>
      page.match(/<meta name="keywords" content="([^"]*)"/)?.[1] ?? "";
    expect(keywords(html(""))).toContain("电报频道大全");
    expect(keywords(html("channel"))).toContain("电报频道大全");
    expect(keywords(html("group"))).toContain("电报群组");
    expect(keywords(html("en/bot"))).toContain("telegram bots list");
    expect(keywords(html("rank"))).toContain("电报频道排名");
    expect(keywords(html("detail/techdaily"))).toMatch(/^每日科技, @techdaily, 开发编程频道/);
    expect(keywords(html("en/channel/tech"))).toContain("telegram channels list");
  });

  test("thin tag pages stay crawlable but are kept out of the index and the sitemap", () => {
    // "programming" has 4 entries, "movies" only 1.
    expect(html("tag/programming")).not.toContain('<meta name="robots"');
    expect(html("tag/movies")).toContain('<meta name="robots" content="noindex, follow">');
    const sitemap = readFileSync(path.join(client, "sitemap-pages.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${siteUrl}/tag/programming/</loc>`);
    expect(sitemap).not.toContain("/tag/movies/");
  });

  test("the tag index lists only tags that lead somewhere, grouped by facet, in both locales", () => {
    for (const [route, topic, attribute, label] of [
      ["tags", "主题", "属性", "编程"],
      ["en/tags", "Topics", "Attributes", "Programming"],
    ] as const) {
      const page = html(route);
      expect(page, route).toContain(topic);
      expect(page, route).toContain(attribute);
      expect(page, route).toContain(label);
      expect(page, route).toContain('data-tag-chip="programming"');
      expect(page, route).toContain('data-tag-chip="free"');
      // A tag nobody used has no listing page, so it is left out rather than linked to a 404.
      expect(page, route).not.toContain('data-tag-chip="linux"');
      expect(types(page), route).toEqual(["ItemList", "BreadcrumbList"]);
    }
    expect(html("tags")).toContain('href="/tag/programming/"');
    expect(html("en/tags")).toContain('href="/en/tag/programming/"');
    // The entry point the tag pages were missing: a footer link on every page, and the sitemap.
    expect(html("")).toContain('href="/tags/"');
    expect(html("en/")).toContain('href="/en/tags/"');
    expect(html("detail/techdaily")).toContain('href="/tags/"');
    const sitemap = readFileSync(path.join(client, "sitemap-pages.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${siteUrl}/tags/</loc>`);
    expect(sitemap).toContain(`<loc>${siteUrl}/en/tags/</loc>`);
  });

  test("the footer credits the open-source repo and the licence on every page", () => {
    for (const [route, label, licence] of [
      ["", "开源于 GitHub", "以 AGPL-3.0 许可证发布"],
      ["en/", "Open source on GitHub", "Released under AGPL-3.0"],
      ["detail/techdaily", "开源于 GitHub", "以 AGPL-3.0 许可证发布"],
    ] as const) {
      const footer = html(route).split("<footer")[1]?.split("</footer>")[0] ?? "";
      expect(footer, route).toMatch(
        new RegExp(`<a[^>]*href="${repoUrl}"[^>]*rel="noopener"[^>]*>[\\s\\S]*?${label}`),
      );
      expect(footer, route).toContain(licence);
      expect(footer, route).toContain(`© ${new Date().getUTCFullYear()} TGbox`);
    }
  });

  test("the about page answers the questions people search, with FAQPage markup", () => {
    for (const [route, heading, question] of [
      ["about", "常见问题", "怎么找 Telegram 频道？"],
      ["en/about", "Frequently asked questions", "How do I find good Telegram channels?"],
    ] as const) {
      const page = html(route);
      expect(page, route).toContain(heading);
      expect(page, route).toMatch(new RegExp(`<h3[^>]*>${question.replace(/\?/g, "\\?")}`));
      expect(page, route).toContain("AGPL-3.0");
      expect(page, route).toContain(repoUrl);
      const faq = jsonLd(page).find(
        (item): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          "@type" in item &&
          item["@type"] === "FAQPage",
      );
      const questions = Array.isArray(faq?.mainEntity) ? faq.mainEntity : [];
      expect(questions.length, route).toBeGreaterThanOrEqual(3);
      expect(questions[0]).toMatchObject({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer" },
      });
    }
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
      // React loads when the visitor reaches for search, not on every page view.
      expect(page).toMatch(/<astro-island[^>]*SearchDialog[^>]*client="search"/);
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

  test("paid banners lead the home and detail promos, ad-space cards fill the other slots", () => {
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
      // Paid cards go through the click counter, which redirects to the advertiser's own link.
      expect(links[0]).toContain(`href="/r/${paidPromo.id}"`);
      expect(links[0]).not.toContain(paidPromo.href);
      expect(links[0]).toContain('rel="sponsored noopener"');
      expect(links[0]).toContain('target="_blank"');
      expect(promos).toContain(`>${label}<`);
      expect(promos).toContain("Rocket &lt;VPN&gt; &amp; Proxy");
      // Unsold cards open the advertising page in the same tab, in the page's language.
      for (const slot of links.slice(1)) {
        expect(slot).toContain(`href="/${route.startsWith("en/") ? "en/" : ""}advertise/"`);
        expect(slot).not.toContain("target=");
      }
    }
    expect(html("")).toContain("广告位招租");
    expect(html("en/")).toContain("Ad space available");
    // Dismissing the lineup is keyed by the paid banner ids only.
    expect(html("")).toMatch(/storageKey = "home-promos:41"/);
    expect(html("")).toContain("data-promos-dismiss");
  });

  test("the promo click counter is the only outgoing link on a paid card", () => {
    for (const route of ["", "en/", "detail/techdaily"]) {
      const card = html(route).match(/<a[^>]*data-promo-sponsored[^>]*>/)?.[0] ?? "";
      expect(card, route).toContain(`href="/r/${paidPromo.id}"`);
      expect(card, route).toContain('target="_blank"');
      // Placeholder cards lead to the advertising page, which links on to the bot.
      const slot = html(route).match(/<a[^>]*data-promo-slot[^>]*>/)?.[0] ?? "";
      expect(slot, route).toMatch(/href="(\/en)?\/advertise\/"/);
    }
    // robots.txt keeps the counter out of the index.
    expect(readFileSync(path.join(client, "robots.txt"), "utf8")).toContain("Disallow: /r/");
  });

  test("a banner with an image uses it as the card background, keeping the gradient behind it", () => {
    for (const route of ["", "detail/techdaily"]) {
      const page = html(route);
      const card = page.match(/<a[^>]*data-promo-sponsored[^>]*>/)?.[0] ?? "";
      expect(card, route).toContain(`data-promo-image="${promoImage}"`);
      expect(card, route).toContain(
        `background:url(&quot;${promoImage}&quot;) center/cover no-repeat,`,
      );
      // The gradient is still the last layer, so a broken image leaves a readable card.
      expect(card, route).toMatch(/no-repeat, radial-gradient\(/);
    }
    // Placeholder cards are unaffected and keep their own background.
    expect(html("")).toMatch(/<a[^>]*data-promo-slot[^>]*class="ad-slot/);
  });

  test("promoted entries lead listings and hot columns with a promoted badge", () => {
    const ai = html("channel/ai");
    expect(ai).toMatch(/data-entry-card="aiwatch"[\s\S]*?data-promoted-badge[\s\S]*?推广/);
    // Every tier shares one look, switched on by the attribute (the hot shuffle toggles it too).
    expect(ai).toMatch(/data-entry-card="aiwatch" data-promoted/);
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

  test("the advertising page lists every placement in both locales, with prices and free slots", () => {
    for (const [route, heading, buy] of [
      ["advertise", "推广我的条目", "在机器人里购买"],
      ["en/advertise", "Promote my listing", "Buy in the bot"],
    ] as const) {
      const page = html(route);
      expect(page, route).toContain(heading);
      expect([...page.matchAll(/data-ad-offer="([a-z_]+)"/g)].map((match) => match[1])).toEqual([
        "highlight",
        "category_pin",
        "pin",
        "banner",
        "announcement",
      ]);
      expect(page, route).toContain(buy);
      expect(page, route).toMatch(/href="https:\/\/t\.me\/\w+\?start=promote"/);
      expect(page, route).toMatch(/data-ad-availability[^>]*>\s*(共 5 个名额|5 slots)/);
      // The sample announcement bar can't dismiss the real one.
      expect(page.match(/<button[^>]*data-announcement-dismiss/g)?.length ?? 0, route).toBeLessThan(
        2,
      );
    }
    expect(html("")).toMatch(/<a href="\/advertise\/"[^>]*>广告投放</);
    expect(readFileSync(path.join(client, "sitemap-pages.xml"), "utf8")).toContain("/advertise/");
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

  test("every directory page offers a way into the bot's submit flow", () => {
    // The deep link existed in the bot all along; nothing on the site ever produced it, so the
    // pages with the most traffic had no way in at all.
    const deepLink = 'href="https://t.me/tgboxccbot?start=submit"';
    for (const route of [
      "channel",
      "group",
      "bot",
      "channel/tech",
      "tag/programming",
      "tags",
      "rank",
      "detail/techdaily",
    ]) {
      for (const prefix of ["", "en/"]) {
        const page = html(`${prefix}${route}`);
        expect(page.split(deepLink).length - 1, `${prefix}${route}`).toBe(1);
      }
    }
    // The slot is opt-in: an article index is not a directory page.
    expect(html("guides")).not.toContain(deepLink);
    expect(html("en/guides")).not.toContain(deepLink);
  });

  test("rankings page exists in both locales with tabs, kind filter and ranked rows", () => {
    for (const prefix of ["", "en/"]) {
      const page = html(`${prefix}rank`);
      expect(page).toContain(`<link rel="canonical" href="${siteUrl}/${prefix}rank/">`);
      expect(page).toContain(`<link rel="alternate" hreflang="en" href="${siteUrl}/en/rank/">`);
      expect(page).toMatch(/<meta name="description" content="[^"]+"/);
      for (const tab of ["weekly", "monthly", "newest", "active"]) {
        expect(page).toContain(`data-rank-panel="${tab}"`);
      }
      for (const kind of ["all", "channel", "group", "bot"]) {
        expect(page).toContain(`data-rank-kind="${kind}"`);
      }
      const weekly = page.split('data-rank-panel="weekly"')[1]?.split("data-rank-panel=")[0] ?? "";
      expect(weekly).toMatch(/data-entry-row="devnotes"[\s\S]*?\+100 \(\+3\.4%\)/);
      expect(weekly).not.toContain('data-entry-row="techdaily"');
      // Header nav and mobile tab bar link the page.
      expect(html(prefix)).toContain(`href="/${prefix}rank/"`);
    }
    expect(html("rank")).toContain("<title>电报频道排名 · Telegram 群组与机器人排行榜 | TGbox<");
    expect(html("")).toMatch(/data-home-rankings[^>]*>|href="\/rank\/"[^>]*data-home-rankings/);
    const sitemap = readFileSync(path.join(client, "sitemap-pages.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${siteUrl}/rank/</loc>`);
    expect(sitemap).toContain(`<loc>${siteUrl}/en/rank/</loc>`);
  });

  test("rankings JSON validates and ranks growth from member history", () => {
    const rankings = RankingsData.parse(
      JSON.parse(readFileSync(path.join(client, "data/rankings.json"), "utf8")),
    );
    expect(rankings.weeklyGrowth.map((item) => item.username)).toEqual(["devnotes"]);
    expect(rankings.weeklyGrowth[0]).toMatchObject({ growth: 100, growthPct: 3.4, members: 3000 });
    expect(rankings.monthlyGrowth[0]).toMatchObject({
      username: "devnotes",
      growth: 1000,
      growthPct: 50,
    });
    expect(rankings.newest).toHaveLength(Math.min(50, approved.length + gameChannels.length));
    expect(rankings.active[0]?.activityTier).toBe(4);
  });

  test("every internal link on every page points to a built file", () => {
    const pages = allFiles(client).filter((file) => file.endsWith(".html"));
    const missing = new Set<string>();
    for (const file of pages) {
      // <template> rows are filled in by scripts, so their placeholder links are not real targets.
      const page = readFileSync(file, "utf8").replace(/<template[\s\S]*?<\/template>/g, "");
      for (const [, href = ""] of page.matchAll(/\shref="(\/(?!\/)[^"]*)"/g)) {
        const target = href.split(/[?#]/)[0] ?? "";
        // /go/ query links, the Pagefind bundle, JSON pools and the promo counter aren't pages.
        if (/^\/(go|pagefind|data|r)\//.test(target)) continue;
        const resolved = path.join(client, target.endsWith("/") ? `${target}index.html` : target);
        if (!existsSync(resolved)) missing.add(`${path.relative(client, file)} → ${href}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test("category sidebar omits empty categories instead of listing them as dead text", () => {
    const tech = html("channel/tech");
    const sidebar = tech.split('class="category-sidebar')[1]?.split("</aside>")[0] ?? "";
    expect(sidebar).toContain('href="/channel/"');
    expect(sidebar).toContain('href="/channel/tech/"');
    // Five channel categories hold approved entries; the other sixteen are left out, not muted.
    expect(sidebar.match(/<li[\s>]/g)).toHaveLength(6);
    expect(sidebar).not.toContain("data-sidebar-empty");
    expect(sidebar).not.toContain("aria-disabled");
    expect(sidebar).not.toContain("/channel/deals/");
    // Counts still ride along with each row.
    expect(sidebar).toMatch(/61\s*<\/span>/);
    // The mobile chip scroller and the tablet icon rail are built from the same list.
    const chips = tech.split('<nav aria-label="分类导航"')[1]?.split("</nav>")[0] ?? "";
    expect(chips).toContain('href="/channel/games/"');
    expect(chips).not.toContain("/channel/deals/");
    expect(chips.match(/<li[\s>]/g)).toHaveLength(6);
  });

  test("category pages filter by tag in the fragment, with no crawlable tag listing", () => {
    for (const [route, label] of [
      ["channel/tech", "#中文"],
      ["en/channel/tech", "#Chinese"],
    ] as const) {
      const page = html(route);
      const filter =
        page.split('<nav aria-label="按标签筛选"')[1] ??
        page.split('<nav aria-label="Filter by tag"')[1] ??
        "";
      expect(filter, route).toContain('data-tag-chip="all"');
      expect(filter, route).toContain('href="#tag=chinese"');
      expect(filter, route).toContain(label);
      // Cards carry their tags, so the filter is pure client-side hiding.
      expect(page, route).toMatch(/data-entry-tags="[^"]*\bchinese\b/);
      expect(page, route).toContain("data-filter-empty");
      expect(page, route).not.toMatch(/href="[^"]*[?&]tag=/);
    }
    // 61 untagged game channels: nothing to narrow down, no chips.
    expect(html("channel/games")).not.toContain("data-tag-chip");
  });

  test("kind overviews filter by tag too, and their view-all links carry the filter along", () => {
    for (const route of ["channel", "en/channel"]) {
      const page = html(route);
      expect(page, route).toContain('data-tag-chip="all"');
      expect(page, route).toContain('href="#tag=chinese"');
      expect(page, route).toContain("data-filter-empty");
      expect(page, route).toMatch(/<a href="[^"#]*\/channel\/games\/"[^>]*data-carry-filter/);
      expect(page, route).not.toMatch(/href="[^"]*[?&]tag=/);
    }
  });

  test("listing pages filter by detected language in the fragment, with no crawlable lang URL", () => {
    for (const prefix of ["", "en/"]) {
      for (const route of [`${prefix}channel`, `${prefix}channel/tech`]) {
        const page = html(route);
        expect(page, route).toContain("data-lang-filter");
        expect(page, route).toContain('data-lang-chip="all"');
        // The choice lives in the fragment, which is never crawled or built as a page.
        expect(page, route).toContain('href="#lang=zh"');
        expect(page, route).toContain('href="#lang=en"');
        // Cards carry the detected language, so the filter is pure client-side hiding.
        expect(page, route).toContain('data-entry-lang="zh"');
        expect(page, route).toContain('data-entry-lang="en"');
        expect(page, route).not.toMatch(/href="[^"]*[?&]lang=/);
      }
    }
    // Chips are named in the reader's own language.
    expect(html("channel")).toMatch(/data-lang-chip="en"[^>]*>\s*英语/);
    expect(html("en/channel")).toMatch(/data-lang-chip="zh"[^>]*>\s*Chinese/);
    // 61 game channels, none with a detected language: nothing to choose between, no chips.
    expect(html("channel/games")).not.toContain("data-lang-filter");
    // No page and no sitemap entry is generated for a language.
    expect(existsSync(path.join(client, "channel/lang"))).toBe(false);
    for (const file of allFiles(client).filter((name) => name.endsWith(".xml"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/[?&]lang=|\/lang\//);
    }
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

  test("guide articles render in both locales with dates, a table of contents and internal links", () => {
    for (const [route, heading, tocLabel, next] of [
      ["guides/find-telegram-channels", "怎么找到优质的 Telegram 频道", "本文目录", "/channel/"],
      [
        "en/guides/find-telegram-channels",
        "How to find good Telegram channels",
        "On this page",
        "/en/channel/",
      ],
    ] as const) {
      const page = html(route);
      expect(page, route).toMatch(new RegExp(`<h1[^>]*>\\s*${heading}`));
      expect(page, route).toContain(tocLabel);
      // Published and updated dates are machine-readable and differ, as the frontmatter says.
      expect(page, route).toContain('<time datetime="2026-09-15T00:00:00.000Z">');
      expect(page, route).toContain('<time datetime="2026-09-17T00:00:00.000Z">');
      // Every markdown h2 has an id and a matching entry in the table of contents.
      const ids = [...page.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1] ?? "");
      expect(ids.length, route).toBeGreaterThanOrEqual(5);
      for (const id of ids) expect(page, `${route} → #${id}`).toContain(`href="#${id}"`);
      // The point of the section: links back into the directory.
      expect(page, route).toContain(`href="${next}"`);
      expect(page, route).toContain("data-guide-next");
    }
    // Inside the prose the zh copy links only zh pages; the language switch in the header is
    // the sole route across locales.
    const zh = html("guides/find-telegram-channels");
    const prose = zh.split('class="prose-tg')[1]?.split("</article>")[0] ?? "";
    expect(prose).toContain('href="/guides/channels-groups-bots/"');
    expect(prose).not.toContain('href="/en/');
    const en = html("en/guides/find-telegram-channels");
    const enProse = en.split('class="prose-tg')[1]?.split("</article>")[0] ?? "";
    expect(enProse).toContain('href="/en/guides/channels-groups-bots/"');
  });

  test("the guides index lists every guide for its locale, newest first", () => {
    for (const [route, first, last] of [
      ["guides", "find-telegram-channels", "grow-a-telegram-channel"],
      ["en/guides", "find-telegram-channels", "grow-a-telegram-channel"],
    ] as const) {
      const page = html(route);
      const slugs = [...page.matchAll(/data-guide-card="([^"]+)"/g)].map((match) => match[1] ?? "");
      expect(slugs, route).toEqual([first, "channels-groups-bots", last]);
      expect(types(page), route).toEqual(["ItemList", "BreadcrumbList"]);
    }
    expect(html("guides")).toContain("怎么找到优质的 Telegram 频道");
    expect(html("en/guides")).toContain("How to find good Telegram channels");
    // Reachable from the footer of every page, and from the guides index breadcrumb.
    expect(html("")).toContain('href="/guides/"');
    expect(html("en/")).toContain('href="/en/guides/"');
  });

  test("guide articles emit Article, FAQPage and BreadcrumbList JSON-LD", () => {
    const page = html("en/guides/find-telegram-channels");
    expect(types(page)).toEqual(["Article", "FAQPage", "BreadcrumbList"]);
    const [article, faq, breadcrumb] = jsonLd(page) as Record<string, unknown>[];
    expect(article).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "How to find good Telegram channels",
      url: `${siteUrl}/en/guides/find-telegram-channels/`,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": `${siteUrl}/en/guides/find-telegram-channels/`,
      },
      datePublished: "2026-09-15T00:00:00.000Z",
      dateModified: "2026-09-17T00:00:00.000Z",
      inLanguage: "en",
      author: { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: "TGbox" },
      publisher: { "@type": "Organization", "@id": `${siteUrl}/#organization` },
    });
    expect(Array.isArray(faq?.mainEntity) && faq.mainEntity.length).toBeGreaterThanOrEqual(2);
    expect(breadcrumb?.itemListElement).toMatchObject([
      { position: 1, item: `${siteUrl}/en/` },
      { position: 2, item: `${siteUrl}/en/guides/` },
      { position: 3, name: "How to find good Telegram channels" },
    ]);
  });

  test("each zh guide pairs with the en guide of the same slug through canonical and hreflang", () => {
    for (const slug of [
      "find-telegram-channels",
      "channels-groups-bots",
      "grow-a-telegram-channel",
    ]) {
      const zh = html(`guides/${slug}`);
      const en = html(`en/guides/${slug}`);
      expect(zh, slug).toContain(`<link rel="canonical" href="${siteUrl}/guides/${slug}/">`);
      expect(en, slug).toContain(`<link rel="canonical" href="${siteUrl}/en/guides/${slug}/">`);
      for (const page of [zh, en]) {
        expect(page, slug).toContain(
          `<link rel="alternate" hreflang="zh-CN" href="${siteUrl}/guides/${slug}/">`,
        );
        expect(page, slug).toContain(
          `<link rel="alternate" hreflang="en" href="${siteUrl}/en/guides/${slug}/">`,
        );
        expect(page, slug).toContain('<meta property="og:type" content="article">');
      }
    }
    for (const route of ["guides", "en/guides"]) {
      expect(html(route), route).toContain(
        `<link rel="alternate" hreflang="en" href="${siteUrl}/en/guides/">`,
      );
    }
  });

  test("the guides sitemap carries both locales with each guide's own lastmod", () => {
    expect(readFileSync(path.join(client, "sitemap-index.xml"), "utf8")).toContain(
      `${siteUrl}/sitemap-guides.xml`,
    );
    const sitemap = readFileSync(path.join(client, "sitemap-guides.xml"), "utf8");
    for (const prefix of ["", "en/"]) {
      expect(sitemap).toContain(`<loc>${siteUrl}/${prefix}guides/</loc>`);
      // "channels-groups-bots" is the only guide revised on the 16th.
      expect(sitemap).toContain(
        `<loc>${siteUrl}/${prefix}guides/channels-groups-bots/</loc><lastmod>2026-09-16T00:00:00.000Z</lastmod>`,
      );
      expect(sitemap).toContain(
        `<loc>${siteUrl}/${prefix}guides/find-telegram-channels/</loc><lastmod>2026-09-17T00:00:00.000Z</lastmod>`,
      );
    }
    expect(sitemap).toContain(
      `<xhtml:link rel="alternate" hreflang="en" href="${siteUrl}/en/guides/find-telegram-channels/"/>`,
    );
  });

  test("every sitemap URL has a lastmod: entries report their own, listings the snapshot", () => {
    const generatedAt = fixtureNow.toISOString();
    for (const shard of ["pages", "guides", "channel-zh", "channel-en", "bot-zh"]) {
      const sitemap = readFileSync(path.join(client, `sitemap-${shard}.xml`), "utf8");
      const locs = sitemap.match(/<loc>/g)?.length ?? 0;
      expect(locs, shard).toBeGreaterThan(0);
      expect(sitemap.match(/<lastmod>/g)?.length, shard).toBe(locs);
      // W3C datetime, which is what the sitemap protocol asks for.
      for (const [, value = ""] of sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) {
        expect(new Date(value).toISOString(), `${shard} → ${value}`).toBe(value);
      }
    }
    const pages = readFileSync(path.join(client, "sitemap-pages.xml"), "utf8");
    expect(pages).toContain(`<loc>${siteUrl}/</loc><lastmod>${generatedAt}</lastmod>`);
    const channels = readFileSync(path.join(client, "sitemap-channel-zh.xml"), "utf8");
    expect(channels).toContain(`<loc>${siteUrl}/channel/</loc><lastmod>${generatedAt}</lastmod>`);
    // techdaily's content changed after it was listed and before the snapshot was built.
    expect(channels).toContain(
      `<loc>${siteUrl}/detail/techdaily/</loc><lastmod>${techdailyUpdatedAt}</lastmod>`,
    );
  });

  test("thin category listings stay crawlable but are kept out of the index and the sitemap", () => {
    // "games" has 61 channels, "tech" only 2 and "news" only 1.
    expect(html("channel/games")).not.toContain('<meta name="robots"');
    for (const route of ["channel/tech", "en/channel/tech", "channel/news"]) {
      expect(html(route), route).toContain('<meta name="robots" content="noindex, follow">');
    }
    const sitemap = readFileSync(path.join(client, "sitemap-channel-zh.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${siteUrl}/channel/games/</loc>`);
    expect(sitemap).not.toContain("/channel/tech/");
    expect(sitemap).not.toContain("/channel/news/");
    // The pages keep their place in the site's own navigation.
    expect(html("channel")).toContain('href="/channel/tech/"');
    expect(html("channel/games")).toContain('href="/channel/tech/"');
  });

  test("home, kind indexes, rankings and detail pages are indexed whatever their size", () => {
    for (const route of ["", "en/", "channel", "group", "bot", "rank", "detail/movieshare"]) {
      expect(html(route), route).not.toContain('<meta name="robots"');
    }
    const sitemap = readFileSync(path.join(client, "sitemap-bot-zh.xml"), "utf8");
    // Both bot categories hold a single entry, yet the kind index and the detail pages stay listed.
    expect(sitemap).toContain(`<loc>${siteUrl}/bot/</loc>`);
    expect(sitemap).toContain(`<loc>${siteUrl}/detail/helperbot/</loc>`);
    expect(sitemap).not.toContain("/bot/tools/");
  });

  test("paginated listings canonicalise to themselves so page 2 isn't folded into page 1", () => {
    for (const prefix of ["", "en/"]) {
      expect(html(`${prefix}channel/games`)).toContain(
        `<link rel="canonical" href="${siteUrl}/${prefix}channel/games/">`,
      );
      expect(html(`${prefix}channel/games/2`)).toContain(
        `<link rel="canonical" href="${siteUrl}/${prefix}channel/games/2/">`,
      );
    }
  });

  test("the Telegram Mini App ships four prerendered pages per locale, each one an island shell", () => {
    for (const prefix of ["", "en/"]) {
      for (const screen of ["app", "app/submit", "app/me", "app/promote"]) {
        const route = `${prefix}${screen}`;
        expect(existsSync(path.join(client, route, "index.html")), route).toBe(true);
        // One island, no SPA fallback and no hash routing: Telegram owns the URL fragment.
        const page = html(route);
        expect(page.match(/<astro-island/g)?.length, route).toBe(1);
        expect(page, route).toMatch(/component-url="[^"]*root\.[^"]*\.js"/);
      }
    }
  });

  test("app pages are noindex and absent from every sitemap", () => {
    for (const prefix of ["", "en/"]) {
      for (const screen of ["app", "app/submit", "app/me", "app/promote"]) {
        const route = `${prefix}${screen}`;
        expect(html(route), route).toContain('<meta name="robots" content="noindex, follow">');
        // noindex pages advertise neither a canonical nor hreflang alternates.
        expect(html(route), route).not.toContain('<link rel="canonical"');
      }
    }
    for (const file of allFiles(client).filter((name) => name.endsWith(".xml"))) {
      expect(readFileSync(file, "utf8"), file).not.toContain("/app/");
    }
    const robots = readFileSync(path.join(client, "robots.txt"), "utf8");
    expect(robots).toContain("Disallow: /app/");
    expect(robots).toContain("Disallow: /en/app/");
  });

  test("the app reads entries, taxonomy and products as static files, not from the Worker", () => {
    const read = (name: string): unknown =>
      JSON.parse(readFileSync(path.join(client, "data", name), "utf8"));
    const entries = read("app-entries.json");
    expect(Array.isArray(entries) && entries.length).toBeGreaterThan(0);
    // The promoted entry leads the browse list, exactly as it leads the site's own listings.
    expect(Array.isArray(entries) && entries[0]).toMatchObject({
      username: "aiwatch",
      kind: "channel",
    });
    const taxonomy = read("app-taxonomy.json");
    expect(taxonomy).toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({ slug: "tech", kind: "channel", id: expect.any(Number) }),
      ]),
    });
    // Submissions post category and tag ids, so the static taxonomy has to carry them.
    expect(taxonomy).toMatchObject({
      tags: expect.arrayContaining([
        expect.objectContaining({ slug: "programming", id: expect.any(Number) }),
      ]),
    });
    // The price list is public — the bot quotes the same products in chat — so it ships static too,
    // together with the methods a buyer can pay with: a price with no button behind it is the bug
    // this shape exists to prevent.
    expect(read("app-products.json")).toMatchObject({
      // Cheapest tier first, as the admin sorts them.
      products: [
        {
          id: 5,
          kind: "highlight",
          days: 7,
          priceStars: expect.any(Number),
          priceUsdt: expect.any(String),
        },
        { id: 6, kind: "highlight", days: 30 },
        { id: 7, kind: "category_pin", days: 7 },
        { id: 8, kind: "category_pin", days: 30 },
        { id: 1, kind: "pin", days: 7 },
        { id: 2, kind: "pin", days: 30 },
        { id: 3, kind: "banner", days: 7 },
        { id: 4, kind: "banner", days: 30 },
        { id: 9, kind: "announcement", days: 7 },
        { id: 10, kind: "announcement", days: 30 },
      ],
      payments: { stars: expect.any(Boolean), usdt: expect.any(Boolean) },
    });
  });
});
