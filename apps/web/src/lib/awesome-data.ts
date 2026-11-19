import type { SiteData } from "@tgbox/shared";
import { siteUrl } from "./site.ts";
import { byMembers } from "./site-data.ts";

/** Entries per category the awesome list shows: its visible rows, nothing to unfold. */
const PER_CATEGORY = 15;
/** The awesome list's "newly listed" highlight. */
const NEWEST = 10;

/**
 * What the awesome-telegram README on GitHub shows, and nothing more: the directory itself is not
 * published as data (see the terms on /about/). The largest entries of each category and the
 * newest ones, with public fields and the admin's `featured` picks, without promotion state,
 * posts, member history or avatar URLs, so the list doesn't hotlink the media bucket.
 */
export function awesomeData(data: SiteData) {
  const largest = byMembers(data.entries);
  const shown = new Set<string>();
  const perCategory = new Map<string, number>();
  for (const entry of largest) {
    const key = `${entry.kind}:${entry.category}`;
    const n = perCategory.get(key) ?? 0;
    if (n >= PER_CATEGORY) continue;
    perCategory.set(key, n + 1);
    shown.add(entry.username);
  }
  const newest = [...data.entries].sort((a, b) => b.listedAt.localeCompare(a.listedAt));
  for (const entry of newest.slice(0, NEWEST)) shown.add(entry.username);
  return {
    version: 1,
    site: siteUrl,
    generatedAt: data.generatedAt,
    stats: data.stats,
    featured: data.featured.map(({ name, url, descZh, descEn }) => ({ name, url, descZh, descEn })),
    categories: data.categories.map(({ kind, slug, nameZh, nameEn, count }) => ({
      kind,
      slug,
      nameZh,
      nameEn,
      count,
    })),
    tags: data.tags.map(({ slug, nameZh, nameEn, count }) => ({ slug, nameZh, nameEn, count })),
    entries: largest
      .filter((entry) => shown.has(entry.username))
      .map((entry) => ({
        username: entry.username,
        startPayload: entry.startPayload,
        kind: entry.kind,
        category: entry.category,
        tags: entry.tags,
        title: entry.title,
        description: entry.description,
        descriptionZh: entry.descriptionZh,
        descriptionEn: entry.descriptionEn,
        lang: entry.lang,
        verified: entry.verified,
        members: entry.members,
        tgCreatedAt: entry.tgCreatedAt,
        listedAt: entry.listedAt,
      })),
  };
}
