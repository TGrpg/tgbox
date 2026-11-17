import type { SiteData } from "@tgbox/shared";
import { siteUrl } from "./site.ts";
import { byMembers } from "./site-data.ts";

/**
 * The whole public directory as one file, for mirrors such as the awesome-telegram list on GitHub.
 * Public entry fields and explicit admin curation (`featured`), without promotion state, posts,
 * member history or avatar URLs, so copies don't hotlink the media bucket.
 */
export function openData(data: SiteData) {
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
    entries: byMembers(data.entries).map((entry) => ({
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
