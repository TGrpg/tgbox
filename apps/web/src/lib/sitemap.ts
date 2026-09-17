import { type EntryKind, entryKinds, type Locale, locales } from "@tgbox/shared";
import { alternatePaths } from "../i18n/locale.ts";
import { GUIDES_PATH, guidePath, listGuides } from "./guides.ts";
import { MIN_INDEXED_LISTING_ENTRIES } from "./seo.ts";
import { absoluteUrl } from "./site.ts";
import { getSiteData, PAGE_SIZE, pageHref } from "./site-data.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * `lastmod` is a W3C datetime (ISO 8601) and has to be true or Google stops trusting the file:
 * a detail page reports when the entry's own content last changed, a guide when the article was
 * last revised, and pages assembled from the whole directory when the snapshot was built.
 */
type SitemapUrl = { path: string; lastmod: string };

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlResponse(body: string) {
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

/** Locale-neutral paths of paged listings: `/base/`, `/base/2/`, … */
function pagedPaths(base: string, count: number) {
  const total = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return Array.from({ length: total }, (_, index) => pageHref(base, index + 1));
}

/** One `<url>` per path in `locale`, each with zh-CN / en / x-default alternates. */
function urls(items: SitemapUrl[], locale: Locale) {
  const link = (hreflang: string, href: string) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(absoluteUrl(href))}"/>`;
  return items.map(({ path, lastmod }) => {
    const alternates = alternatePaths(path);
    return [
      "<url>",
      `<loc>${escapeXml(absoluteUrl(alternates[locale]))}</loc>`,
      `<lastmod>${escapeXml(lastmod)}</lastmod>`,
      link("zh-CN", alternates.zh),
      link("en", alternates.en),
      link("x-default", alternates.zh),
      "</url>",
    ].join("");
  });
}

function urlset(items: string[]) {
  return xmlResponse(
    `${XML_HEADER}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${items.join("\n")}\n</urlset>\n`,
  );
}

const STATIC_PAGES = [
  "/",
  "/rank/",
  "/random/",
  "/enroll/",
  "/about/",
  "/privacy-policy/",
  "/donate/",
  "/links/",
];

function shardNames() {
  return [
    "pages",
    "guides",
    ...entryKinds.flatMap((kind) => locales.map((locale) => `${kind}-${locale}`)),
  ];
}

export function sitemapIndex() {
  const items = shardNames().map(
    (name) => `<sitemap><loc>${escapeXml(absoluteUrl(`/sitemap-${name}.xml`))}</loc></sitemap>`,
  );
  return xmlResponse(
    `${XML_HEADER}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`,
  );
}

/** Home, content pages and tag listings in both locales. */
export function pagesSitemap() {
  const data = getSiteData();
  // Tags below the threshold are noindexed (see MIN_INDEXED_LISTING_ENTRIES), so don't advertise them.
  const tagPaths = data.tags
    .filter((tag) => tag.count >= MIN_INDEXED_LISTING_ENTRIES)
    .flatMap((tag) => pagedPaths(`/tag/${tag.slug}/`, tag.count));
  // These pages are assembled from the directory as a whole, so the snapshot is their last change.
  const items = [...STATIC_PAGES, ...tagPaths].map((path) => ({
    path,
    lastmod: data.generatedAt,
  }));
  return urlset(locales.flatMap((locale) => urls(items, locale)));
}

/** The guides index and every article, each dated by its own `updatedAt`. */
export async function guidesSitemap() {
  const shards = await Promise.all(
    locales.map(async (locale) => {
      const guides = await listGuides(locale);
      const updated = guides.map((guide) => guide.data.updatedAt.toISOString()).sort();
      const newest = updated.at(-1) ?? getSiteData().generatedAt;
      return urls(
        [
          { path: GUIDES_PATH, lastmod: newest },
          ...guides.map((guide) => ({
            path: guidePath(guide.data.slug),
            lastmod: guide.data.updatedAt.toISOString(),
          })),
        ],
        locale,
      );
    }),
  );
  return urlset(shards.flat());
}

/** Kind index, its category listings and detail pages, for one locale. */
export function kindSitemap(kind: EntryKind, locale: Locale) {
  const data = getSiteData();
  // Categories holding one or two entries are noindexed for the same reason thin tags are.
  const listings = [
    `/${kind}/`,
    ...data.categories
      .filter((category) => category.kind === kind && category.count >= MIN_INDEXED_LISTING_ENTRIES)
      .flatMap((category) => pagedPaths(`/${kind}/${category.slug}/`, category.count)),
  ].map((path) => ({ path, lastmod: data.generatedAt }));
  const details = data.entries
    .filter((entry) => entry.kind === kind)
    .map((entry) => ({ path: `/detail/${entry.username}/`, lastmod: entry.updatedAt }));
  return urlset(urls([...listings, ...details], locale));
}
