import type { EntryKind, EntryView, SiteData, TagView } from "@tgbox/shared";
import { byMembers, PAGE_SIZE, promotedFirst } from "./site-data.ts";

/** Category pages are built in both orders: `/<kind>/<cat>/` and `/<kind>/<cat>/latest/`. */
export const listingSorts = ["members", "latest"] as const;
export type ListingSort = (typeof listingSorts)[number];

/** Newest listing first. */
function byListedAt(entries: EntryView[]): EntryView[] {
  return [...entries].sort(
    (a, b) => b.listedAt.localeCompare(a.listedAt) || a.username.localeCompare(b.username),
  );
}

/** Every caller lists one category (its page, or its section of an overview). */
export function sortEntries(entries: EntryView[], sort: ListingSort): EntryView[] {
  return promotedFirst(sort === "latest" ? byListedAt(entries) : byMembers(entries), "category");
}

/** Locale-neutral first-page path of a category listing in the given order. */
export function categoryListingBase(kind: EntryKind, slug: string, sort: ListingSort) {
  return sort === "latest" ? `/${kind}/${slug}/latest/` : `/${kind}/${slug}/`;
}

/** getStaticPaths for `[kind]/[category]/[...page]`: every non-empty category × order × page. */
export function categoryListingPaths(data: SiteData) {
  return data.categories
    .filter((category) => category.count > 0)
    .flatMap((category) =>
      listingSorts.flatMap((sort) =>
        Array.from({ length: Math.max(1, Math.ceil(category.count / PAGE_SIZE)) }, (_, index) => {
          const page = index + 1;
          const segments = [sort === "latest" ? "latest" : "", page > 1 ? String(page) : ""];
          const rest = segments.filter(Boolean).join("/");
          return {
            params: { kind: category.kind, category: category.slug, page: rest || undefined },
            props: { category, sort, page },
          };
        }),
      ),
    );
}

/** Kind overview: one section per non-empty category with its promoted, then largest entries. */
export function kindSections(data: SiteData, kind: EntryKind, limit = 10) {
  return data.categories
    .filter((category) => category.kind === kind && category.count > 0)
    .map((category) => ({
      category,
      entries: sortEntries(
        data.entries.filter((item) => item.kind === kind && item.category === category.slug),
        "members",
      ).slice(0, limit),
    }))
    .filter((section) => section.entries.length > 0);
}

/**
 * Detected languages among the entries a page actually renders, most common first. Drives the
 * listing pages' language chips, so it is computed from the rendered slice: every chip a page
 * shows is then guaranteed to leave at least one entry visible.
 */
export function listingLangs(entries: Pick<EntryView, "lang">[], limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.lang === null) continue;
    counts.set(entry.lang, (counts.get(entry.lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, limit)
    .map(([lang]) => lang);
}

/**
 * Tags among the entries a page renders, most used first: the listing pages' tag chips. A tag every
 * entry carries is left out, since choosing it would hide nothing.
 */
export function listingTags(
  entries: Pick<EntryView, "tags">[],
  limit = 12,
): { slug: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const slug of entry.tags) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count < entries.length)
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, limit)
    .map(([slug, count]) => ({ slug, count }));
}

/** Tags that most often appear alongside `slug`. */
export function relatedTags(data: SiteData, slug: string, limit = 16): TagView[] {
  const counts = new Map<string, number>();
  for (const item of data.entries) {
    if (!item.tags.includes(slug)) continue;
    for (const other of item.tags) {
      if (other !== slug) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return data.tags
    .filter((tag) => (counts.get(tag.slug) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0) || b.count - a.count)
    .slice(0, limit);
}
