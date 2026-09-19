import type { Locale } from "@tgbox/shared";

export type LangChoice = { redirect: Locale } | { suggest: Locale } | null;

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
  current: Locale,
): LangChoice {
  if (stored === "zh" || stored === "en") return stored === current ? null : { redirect: stored };
  if (languages.length === 0) return null;
  const zh = (tag: string) => /^zh\b/i.test(tag);
  // A Chinese first choice wants zh; Chinese anywhere else in the list makes either page fine.
  const wanted: Locale = zh(languages[0] ?? "") ? "zh" : languages.some(zh) ? current : "en";
  return wanted === current ? null : { suggest: wanted };
}
