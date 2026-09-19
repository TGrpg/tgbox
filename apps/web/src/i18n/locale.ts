import { type SiteLocale, siteLocales } from "@tgbox/shared";

export const htmlLang: Record<SiteLocale, string> = { zh: "zh-CN", "zh-hant": "zh-Hant", en: "en" };

/** Each locale's name in its own language, for the switcher and the suggestion bar. */
export const localeNames: Record<SiteLocale, string> = {
  zh: "简体中文",
  "zh-hant": "繁體中文",
  en: "English",
};

/** Short switcher labels; `title` carries the full name. */
export const localeShortNames: Record<SiteLocale, string> = { zh: "简", "zh-hant": "繁", en: "EN" };

/** The suggestion bar offers a locale in that locale's own language. */
export const localeOffers: Record<
  SiteLocale,
  { suggest: string; switchLabel: string; dismiss: string }
> = {
  zh: { suggest: "本页有简体中文版。", switchLabel: "切换到简体中文", dismiss: "不再提示" },
  "zh-hant": { suggest: "本頁有繁體中文版。", switchLabel: "切換到繁體中文", dismiss: "不再提示" },
  en: {
    suggest: "This page is available in English.",
    switchLabel: "Switch to English",
    dismiss: "Don't suggest again",
  },
};

/** URL prefix of each locale; zh lives at the root. */
const prefixes: Record<SiteLocale, string> = { zh: "", "zh-hant": "/zh-hant", en: "/en" };

function isLocale(value: string | undefined): value is SiteLocale {
  return siteLocales.some((locale) => locale === value);
}

/** Works for both `Astro` and plain `{ currentLocale, url }` objects. */
export function getLocale(astro: { currentLocale: string | undefined; url: URL }): SiteLocale {
  if (isLocale(astro.currentLocale)) return astro.currentLocale;
  const prefix = /^\/(en|zh-hant)(\/|$)/.exec(astro.url.pathname)?.[1];
  return isLocale(prefix) ? prefix : "zh";
}

/** zh lives at the root, the others under `/en/` and `/zh-hant/`. Accepts a path in any locale. */
export function localizePath(path: string, locale: SiteLocale): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const neutral = absolute.replace(/^\/(en|zh-hant)(?=\/|$)/, "") || "/";
  return `${prefixes[locale]}${neutral}`;
}

export function alternatePaths(path: string): Record<SiteLocale, string> {
  return {
    zh: localizePath(path, "zh"),
    "zh-hant": localizePath(path, "zh-hant"),
    en: localizePath(path, "en"),
  };
}

/** A 404 page (`/404.html`, `/en/404.html`, …) has no counterpart in the other locales. */
export function isNotFoundPath(path: string): boolean {
  return /^(\/en|\/zh-hant)?\/404(\.html)?\/?$/.test(path);
}

/**
 * A JSON file the browser fetches (`/data/…`). zh-hant has its own copy, converted with its pages;
 * en reads the zh file, whose text is the entries' own.
 */
export function dataPath(file: string, locale: SiteLocale): string {
  return `${locale === "zh-hant" ? "/zh-hant" : ""}/data/${file}`;
}
