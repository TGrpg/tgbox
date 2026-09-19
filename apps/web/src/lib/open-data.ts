import type { SiteData } from "@tgbox/shared";
import { siteUrl } from "./site.ts";
import { byMembers } from "./site-data.ts";

/**
 * The whole public directory as one file, for mirrors such as the awesome-telegram list on GitHub.
 * Only what the site already shows: no promotion state, posts or member history, and no avatar
 * URLs, so copies don't hotlink the media bucket.
 */
export function openData(data: SiteData) {
  return {
    version: 1,
    site: siteUrl,
    generatedAt: data.generatedAt,
    stats: data.stats,
    categories: data.categories.map(({ kind, slug, nameZh, nameEn, count }) => ({
      kind,
      slug,
      nameZh,
      nameEn,
      count,
    })),
    tags: data.tags.map(({ slug, nameZh, nameEn, count }) => ({ slug, nameZh, nameEn, count })),
    entries: byMembers(data.entries).map((entry) => ({
      username: entry.username,
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
