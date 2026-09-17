import type { EntryKind, Locale } from "@tgbox/shared";
import { seoUi } from "../i18n/ui-seo.ts";
import { fill } from "./format.ts";

/** `title` carries no site name — `Seo.astro` appends it. */
export type PageSeo = { title: string; description: string; keywords: string };

/**
 * A tag or category listing with fewer entries than this is a near-duplicate of the pages it links
 * to, which is the classic thin-content liability on a small directory. Such pages stay crawlable
 * and stay in the site's own navigation, but are noindexed and kept out of the sitemap until they
 * fill up. Kind indexes, the home page, `/rank/` and detail pages are never held back this way.
 */
export const MIN_INDEXED_LISTING_ENTRIES = 3;

/** Roughly what Google renders before truncating; Chinese glyphs are about twice as wide. */
export const descriptionBudget: Record<Locale, number> = { zh: 90, en: 170 };

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Dedupes while keeping the first occurrence, so the most specific terms lead. */
export function keywords(...groups: string[][]): string {
  return [...new Set(groups.flat().filter((word) => word.trim() !== ""))].join(", ");
}

function suffix(locale: Locale, page: number): string {
  return page > 1 ? fill(seoUi(locale).pageSuffix, { n: page }) : "";
}

const EXAMPLE_LIMIT = 3;

/**
 * "（如 A、B、C）" / " such as A, B, C" — real entry names keep two listing descriptions from
 * reading identically, which is what stops them being treated as duplicates.
 */
export function formatExamples(locale: Locale, names: string[]): string {
  const { examples } = seoUi(locale);
  const picked = names.filter((name) => name.trim() !== "").slice(0, EXAMPLE_LIMIT);
  return picked.length === 0 ? "" : fill(examples.wrap, { list: picked.join(examples.separator) });
}

export function homeSeo(locale: Locale, stats: { total: number }): PageSeo {
  const strings = seoUi(locale);
  return {
    title: strings.home.title,
    description: fill(strings.home.description, { total: stats.total }),
    keywords: keywords(
      strings.keywords.base,
      strings.keywords.kind.channel,
      strings.keywords.kind.group,
      strings.keywords.kind.bot,
    ),
  };
}

export function kindSeo(
  locale: Locale,
  kind: EntryKind,
  input: { count: number; examples: string[] },
): PageSeo {
  const strings = seoUi(locale);
  return {
    title: strings.kind[kind].title,
    description: fill(strings.kind[kind].description, {
      n: input.count,
      examples: formatExamples(locale, input.examples),
    }),
    keywords: keywords(strings.keywords.kind[kind], strings.keywords.base),
  };
}

export function categorySeo(
  locale: Locale,
  input: {
    kind: EntryKind;
    kindWord: string;
    category: string;
    count: number;
    page: number;
    examples: string[];
  },
): PageSeo {
  const strings = seoUi(locale);
  const values = {
    category: input.category,
    kind: input.kindWord,
    n: input.count,
    examples: formatExamples(locale, input.examples),
  };
  return {
    title: fill(strings.category.title, values) + suffix(locale, input.page),
    description: fill(strings.category.description, values),
    keywords: keywords(
      [fill(strings.keywords.categoryKind, values), input.category],
      strings.keywords.kind[input.kind],
      strings.keywords.base,
    ),
  };
}

export function tagSeo(
  locale: Locale,
  input: { tag: string; count: number; page: number; examples: string[] },
): PageSeo {
  const strings = seoUi(locale);
  const values = {
    tag: input.tag,
    n: input.count,
    examples: formatExamples(locale, input.examples),
  };
  return {
    title: fill(strings.tag.title, values) + suffix(locale, input.page),
    description: fill(strings.tag.description, values),
    keywords: keywords([input.tag], strings.keywords.kind.channel, strings.keywords.base),
  };
}

export function rankSeo(locale: Locale): PageSeo {
  const strings = seoUi(locale);
  return {
    title: strings.rank.title,
    description: strings.rank.description,
    keywords: keywords(strings.keywords.rank, strings.keywords.base),
  };
}

export function guidesSeo(locale: Locale): PageSeo {
  const strings = seoUi(locale);
  return {
    title: strings.guides.title,
    description: strings.guides.description,
    keywords: keywords(strings.keywords.guides, strings.keywords.base),
  };
}

export function aboutSeo(locale: Locale): PageSeo {
  const strings = seoUi(locale);
  return {
    title: strings.about.title,
    description: strings.about.description,
    keywords: keywords(strings.keywords.base, strings.faq.map((item) => item.question).slice(0, 2)),
  };
}

/** Pieces the views resolve (formatted numbers, localized names) before the sentence is written. */
export type EntryFacts = {
  title: string;
  username: string;
  /** "频道" / "channel" — already cased for mid-sentence use. */
  kindWord: string;
  categoryName: string;
  /** Formatted count plus its noun ("订阅" / "subscribers"); null when unknown. */
  members: { count: string; noun: string } | null;
  /** Formatted creation date; null when unknown. */
  created: string | null;
  /** Activity tier label; null when there is no data. */
  activity: string | null;
  /** Display name of the detected language; null when unknown. */
  language: string | null;
};

/**
 * One sentence about an entry, built from whatever facts exist. Shown above the stats table and
 * reused as the meta description, so the page leads with prose rather than a bare table.
 */
export function entrySummary(locale: Locale, facts: EntryFacts): string {
  const { summary } = seoUi(locale);
  const clauses = [
    fill(summary.lead, {
      title: facts.title,
      username: facts.username,
      category: facts.categoryName,
      kind: facts.kindWord,
    }),
    facts.members && fill(summary.members, { n: facts.members.count, noun: facts.members.noun }),
    facts.created && fill(summary.created, { date: facts.created }),
    facts.activity && fill(summary.activity, { tier: facts.activity }),
    facts.language && fill(summary.language, { language: facts.language }),
  ].filter((clause) => typeof clause === "string");
  return clauses.join(summary.separator) + summary.terminator;
}

export function detailSeo(
  locale: Locale,
  input: {
    facts: EntryFacts;
    kind: EntryKind;
    /** The description shown in this locale (translated when available). */
    description: string;
    tags: string[];
  },
): PageSeo {
  const strings = seoUi(locale);
  const { facts } = input;
  const summary = entrySummary(locale, facts);
  return {
    title: fill(strings.detail.title, {
      title: facts.title,
      username: facts.username,
      kind: facts.kindWord,
    }),
    description: truncate(`${summary} ${input.description}`, descriptionBudget[locale]),
    keywords: keywords(
      [
        facts.title,
        `@${facts.username}`,
        fill(strings.keywords.categoryKind, {
          category: facts.categoryName,
          kind: facts.kindWord,
        }),
      ],
      input.tags,
      strings.keywords.kind[input.kind],
      strings.keywords.base,
    ),
  };
}

/**
 * The description to render in `locale`: the machine translation when the bot produced one,
 * otherwise the original text from Telegram. `translated` drives the "auto-translated" hint.
 */
export function localizedDescription(
  entry: { description: string; descriptionZh?: string | null; descriptionEn?: string | null },
  locale: Locale,
): { text: string; translated: boolean } {
  const candidate = (locale === "zh" ? entry.descriptionZh : entry.descriptionEn)?.trim();
  if (!candidate || candidate === entry.description.trim()) {
    return { text: entry.description, translated: false };
  }
  return { text: candidate, translated: true };
}
