import { type EntryKind, entryKinds, type Locale, locales } from "@tgbox/shared";
import { alternatePaths } from "../i18n/locale.ts";
import { absoluteUrl } from "./site.ts";
import { getSiteData, PAGE_SIZE, pageHref } from "./site-data.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

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
function urls(paths: string[], locale: Locale) {
  const link = (hreflang: string, href: string) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(absoluteUrl(href))}"/>`;
  return paths.map((path) => {
    const alternates = alternatePaths(path);
    return [
      "<url>",
      `<loc>${escapeXml(absoluteUrl(alternates[locale]))}</loc>`,
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
  return ["pages", ...entryKinds.flatMap((kind) => locales.map((locale) => `${kind}-${locale}`))];
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
  const tagPaths = getSiteData()
    .tags.filter((tag) => tag.count > 0)
    .flatMap((tag) => pagedPaths(`/tag/${tag.slug}/`, tag.count));
  const paths = [...STATIC_PAGES, ...tagPaths];
  return urlset(locales.flatMap((locale) => urls(paths, locale)));
}

/** Kind index, its category listings and detail pages, for one locale. */
export function kindSitemap(kind: EntryKind, locale: Locale) {
  const data = getSiteData();
  const paths = [
    `/${kind}/`,
    ...data.categories
      .filter((category) => category.kind === kind && category.count > 0)
      .flatMap((category) => pagedPaths(`/${kind}/${category.slug}/`, category.count)),
    ...data.entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => `/detail/${entry.username}/`),
  ];
  return urlset(urls(paths, locale));
}
