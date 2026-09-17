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

export function sortEntries(entries: EntryView[], sort: ListingSort): EntryView[] {
  return promotedFirst(sort === "latest" ? byListedAt(entries) : byMembers(entries));
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
