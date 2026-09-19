import type { SiteLocale } from "@tgbox/shared";

export type LangChoice = { redirect: SiteLocale } | { suggest: SiteLocale } | null;

/**
 * What the head script does with a visitor's language, before first paint. A choice they made
 * (switcher click or dismissed suggestion) is followed; crawlers carry none, so they always get the
 * page they asked for. Otherwise the browser's languages only ever produce a suggestion.
 *
 * Self-contained on purpose: BaseLayout inlines its source (`toString()`) into the head script.
 */
export function langChoice(
  stored: string | null,
  languages: readonly string[],
  current: SiteLocale,
): LangChoice {
  if (stored === "zh" || stored === "zh-hant" || stored === "en") {
    return stored === current ? null : { redirect: stored };
  }
  if (languages.length === 0) return null;
  const zh = (tag: string) => /^zh\b/i.test(tag);
  // Traditional script, or a region that writes it when the tag names no script.
  const hant = (tag: string) => /^zh-(hant|tw|hk|mo)\b/i.test(tag);
  const first = languages[0] ?? "";
  // A Chinese first choice wants its script; Chinese anywhere else in the list makes any page fine.
  const wanted: SiteLocale = zh(first)
    ? hant(first)
      ? "zh-hant"
      : "zh"
    : languages.some(zh)
      ? current
      : "en";
  return wanted === current ? null : { suggest: wanted };
}
