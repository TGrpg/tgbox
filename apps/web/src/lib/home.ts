import type { CategoryView, EntryKind, EntryView } from "@tgbox/shared";
import type { HotItem } from "./home-hot.ts";
import { byMembers, promotedFirst } from "./site-data.ts";

/** Entries per kind in the static `/data/hot-<kind>.json` pool. */
const HOT_POOL_SIZE = 50;

/** Largest categories; a slug shared by several kinds appears once, for its biggest kind. */
export function hotCategories(categories: CategoryView[], limit: number): CategoryView[] {
  const seen = new Set<string>();
  return categories
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count || a.sort - b.sort)
    .filter((category) => !seen.has(category.slug) && seen.add(category.slug))
    .slice(0, limit);
}

/** Promoted, then biggest entries of a kind (the column's first rows are this order too). */
export function hotEntries(entries: EntryView[], kind: EntryKind): EntryView[] {
  return promotedFirst(byMembers(entries.filter((entry) => entry.kind === kind)));
}

/** `hotEntries` with short keys to keep the static JSON small. */
export function hotPool(entries: EntryView[], kind: EntryKind, size = HOT_POOL_SIZE): HotItem[] {
  return hotEntries(entries, kind)
    .slice(0, size)
    .map((entry) => ({
      u: entry.username,
      t: entry.title,
      v: entry.verified,
      a: entry.avatarUrl,
      m: entry.members,
      p: entry.isPromoted,
    }));
}

export function latestEntries(entries: EntryView[], limit: number): EntryView[] {
  return [...entries]
    .sort((a, b) => b.listedAt.localeCompare(a.listedAt) || a.username.localeCompare(b.username))
    .slice(0, limit);
}
