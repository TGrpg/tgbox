import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type CategoryView,
  type EntryKind,
  type EntryView,
  entryKinds,
  type Locale,
  SiteData,
  type TagView,
} from "@tgbox/shared";
import { devSiteData } from "./dev-site-data.ts";

export const PAGE_SIZE = 60;

let cached: SiteData | undefined;

/**
 * Snapshot JSON produced by @tgbox/snapshot, read at build time from `SITE_DATA_PATH`
 * (default `.data/site-data.json` in the web app). Without either, a tiny dev dataset is used.
 */
export function getSiteData(): SiteData {
  if (cached) return cached;
  const explicit = process.env.SITE_DATA_PATH;
  const file = explicit ?? path.resolve(".data/site-data.json");
  if (existsSync(file)) {
    cached = SiteData.parse(JSON.parse(readFileSync(file, "utf8")));
  } else if (explicit) {
    throw new Error(`SITE_DATA_PATH points to a missing file: ${explicit}`);
  } else {
    cached = devSiteData;
  }
  return cached;
}

let byUsername: Map<string, EntryView> | undefined;

export function findEntries(usernames: string[]): EntryView[] {
  byUsername ??= new Map(getSiteData().entries.map((entry) => [entry.username, entry]));
  return usernames.flatMap((username) => byUsername?.get(username) ?? []);
}

/**
 * Paid positions lead: site-wide pins on every list, category pins on the lists of their own
 * category. The sort is stable, so the incoming order holds within each group.
 */
export function promotedFirst(entries: EntryView[], scope: "site" | "category"): EntryView[] {
  const rank = ({ promo }: EntryView) =>
    promo === "pin" ? 2 : scope === "category" && promo === "category_pin" ? 1 : 0;
  return [...entries].sort((a, b) => rank(b) - rank(a));
}

/** Site-wide pins shown in a detail page's "discover more" list, ahead of the similar entries. */
const RELATED_PINS = 2;

/**
 * A detail page's "discover more" list of one kind: up to two site-wide pins lead (they paid for
 * every list), then the similar entries with category pins of this entry's own category first.
 * The list keeps its length, so the paid rows replace the least similar ones.
 */
export function relatedWithPromos(
  entry: Pick<EntryView, "username" | "category">,
  kind: EntryKind,
  similar: EntryView[],
): EntryView[] {
  if (similar.length === 0) return [];
  const pins = getSiteData()
    .entries.filter(
      (other) => other.kind === kind && other.promo === "pin" && other.username !== entry.username,
    )
    .slice(0, RELATED_PINS);
  const rank = (other: EntryView) =>
    other.promo === "pin"
      ? 2
      : other.promo === "category_pin" && other.category === entry.category
        ? 1
        : 0;
  const pinned = new Set(pins.map((pin) => pin.username));
  return [...pins, ...similar.filter((other) => !pinned.has(other.username))]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, similar.length);
}

/** Largest first; entries without a member count go last. */
export function byMembers(entries: EntryView[]): EntryView[] {
  return [...entries].sort(
    (a, b) => (b.members ?? -1) - (a.members ?? -1) || a.username.localeCompare(b.username),
  );
}

export function localName(item: { nameZh: string; nameEn: string }, locale: Locale) {
  return locale === "zh" ? item.nameZh : item.nameEn;
}

export function findCategory(kind: EntryKind, slug: string): CategoryView | undefined {
  return getSiteData().categories.find((c) => c.kind === kind && c.slug === slug);
}

export function findTag(slug: string): TagView | undefined {
  return getSiteData().tags.find((tag) => tag.slug === slug);
}

/** `/base/` for page 1, `/base/<n>/` after. */
export function pageHref(base: string, page: number) {
  return page === 1 ? base : `${base}${page}/`;
}

function pagedPaths<TParams, TProps>(
  count: number,
  build: (page: number) => { params: TParams; props: TProps },
) {
  const total = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return Array.from({ length: total }, (_, index) => build(index + 1));
}

export function pageSlice<TItem>(items: TItem[], page: number): TItem[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

// getStaticPaths builders shared by the zh and en route files.

export function kindPaths() {
  return entryKinds.map((kind) => ({ params: { kind }, props: { kind } }));
}

export function tagPaths() {
  return getSiteData()
    .tags.filter((tag) => tag.count > 0)
    .flatMap((tag) =>
      pagedPaths(tag.count, (page) => ({
        params: { slug: tag.slug, page: page === 1 ? undefined : String(page) },
        props: { tag, page },
      })),
    );
}

export function detailPaths() {
  return getSiteData().entries.map((entry) => ({
    params: { username: entry.username },
    props: { entry },
  }));
}
