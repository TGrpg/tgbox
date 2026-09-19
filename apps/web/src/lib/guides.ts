import { type CollectionEntry, getCollection } from "astro:content";
import { type SiteLocale, textLocale } from "@tgbox/shared";
import type { MarkdownHeading } from "astro";

export type Guide = CollectionEntry<"guides">;

/** Locale-neutral path; `localizePath` puts the en copy under `/en/`. */
export function guidePath(slug: string) {
  return `/guides/${slug}/`;
}

export const GUIDES_PATH = "/guides/";

/** Newest first — an index that leads with stale copy is the thing search engines discount. */
export async function listGuides(locale: SiteLocale): Promise<Guide[]> {
  const guides = await getCollection("guides", (guide) => guide.data.locale === textLocale(locale));
  return guides.sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

/** getStaticPaths builder shared by `/guides/[slug]` and `/en/guides/[slug]`. */
export async function guidePaths(locale: SiteLocale) {
  const guides = await listGuides(locale);
  return guides.map((guide) => ({ params: { slug: guide.data.slug }, props: { guide } }));
}

/** Rough reading time from the markdown source: CJK counts per character, the rest per word. */
export function readingMinutes(body: string) {
  // U+3400..U+9FFF covers the CJK ideographs the guides are written in.
  const cjk = body.match(/[㐀-鿿]/g)?.length ?? 0;
  const words = body
    .replace(/[㐀-鿿]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

export type TocItem = { slug: string; text: string; children: { slug: string; text: string }[] };

/**
 * h2 sections with their h3 subsections. h3s before the first h2 (there shouldn't be any) and
 * anything deeper are dropped rather than rendered at the wrong level.
 */
export function tableOfContents(headings: MarkdownHeading[]): TocItem[] {
  const items: TocItem[] = [];
  for (const heading of headings) {
    if (heading.depth === 2) {
      items.push({ slug: heading.slug, text: heading.text, children: [] });
    } else if (heading.depth === 3) {
      items.at(-1)?.children.push({ slug: heading.slug, text: heading.text });
    }
  }
  return items;
}
