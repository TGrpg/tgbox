import { type Locale, locales } from "@tgbox/shared";

export const htmlLang: Record<Locale, string> = { zh: "zh-CN", en: "en" };

function isLocale(value: string | undefined): value is Locale {
  return locales.some((locale) => locale === value);
}

/** Works for both `Astro` and plain `{ currentLocale, url }` objects. */
export function getLocale(astro: { currentLocale: string | undefined; url: URL }): Locale {
  if (isLocale(astro.currentLocale)) return astro.currentLocale;
  return /^\/en(\/|$)/.test(astro.url.pathname) ? "en" : "zh";
}

/** zh lives at the root, en under `/en/`. Accepts a path in either locale. */
export function localizePath(path: string, locale: Locale): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const neutral = absolute.replace(/^\/en(?=\/|$)/, "") || "/";
  return locale === "en" ? `/en${neutral}` : neutral;
}

export function alternatePaths(path: string): Record<Locale, string> {
  return { zh: localizePath(path, "zh"), en: localizePath(path, "en") };
}
