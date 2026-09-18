import type { EntryKind, EntryProductKind, ProductView, PromoView, SiteData } from "@tgbox/shared";

/**
 * Static JSON the Telegram Mini App reads directly from the CDN (`/data/app-*.json`). None of it
 * touches a Worker — see `.scratch/miniapp-contract.md`, "Data that must NOT come from the Worker".
 *
 * No node imports here: the client imports the types from this module.
 */

/**
 * Entries per kind in the browse list. The app is a phone-sized list with a search box, so the
 * whole directory would be megabytes of JSON nobody scrolls; anything past the cut is found
 * through Pagefind, which is a separate, already-built index.
 */
export const APP_BROWSE_LIMIT = 200;

export type AppEntry = {
  username: string;
  kind: EntryKind;
  title: string;
  members: number | null;
  avatarUrl: string | null;
  /** Any live entry promotion: the row is tinted and tagged like on the site. */
  promo: EntryProductKind | null;
};

/** Browse: the entry list plus the paid ads the site shows, so the app carries them too. */
export type AppBrowse = {
  entries: AppEntry[];
  /** Paid bars take turns: the app shows one at random, like the site. */
  announcements: PromoView[];
  banners: PromoView[];
};

export type AppCategory = {
  id: number;
  slug: string;
  kind: EntryKind;
  nameZh: string;
  nameEn: string;
  count: number;
};

export type AppTag = { id: number; slug: string; nameZh: string; nameEn: string };

export type AppTaxonomy = { categories: AppCategory[]; tags: AppTag[] };

export function appBrowse(data: SiteData): AppBrowse {
  return {
    entries: appEntries(data),
    announcements: data.sponsoredAnnouncements,
    banners: data.promos,
  };
}

/** Site-wide pins first, then the largest, capped per kind. */
function appEntries(data: SiteData): AppEntry[] {
  const ranked = [...data.entries].sort(
    (a, b) =>
      Number(b.promo === "pin") - Number(a.promo === "pin") ||
      (b.members ?? -1) - (a.members ?? -1) ||
      a.username.localeCompare(b.username),
  );
  const perKind = new Map<EntryKind, number>();
  return ranked.flatMap((entry) => {
    const taken = perKind.get(entry.kind) ?? 0;
    if (taken >= APP_BROWSE_LIMIT) return [];
    perKind.set(entry.kind, taken + 1);
    return [
      {
        username: entry.username,
        kind: entry.kind,
        title: entry.title,
        members: entry.members,
        avatarUrl: entry.avatarUrl,
        promo: entry.promo,
      },
    ];
  });
}

/** Both locales in one file: the app can switch language without fetching anything. */
export function appTaxonomy(data: SiteData): AppTaxonomy {
  return {
    categories: data.categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      kind: category.kind,
      nameZh: category.nameZh,
      nameEn: category.nameEn,
      count: category.count,
    })),
    tags: data.tags.map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      nameZh: tag.nameZh,
      nameEn: tag.nameEn,
    })),
  };
}

export type AppProducts = { products: ProductView[]; payments: SiteData["payments"] };

/**
 * The price list plus which methods can actually be paid with. They travel together because a
 * price is only worth showing if there is a button behind it — quoting Stars while Stars is off
 * is what this shape exists to prevent.
 */
export function appProducts(data: SiteData): AppProducts {
  return { products: data.products, payments: data.payments };
}
