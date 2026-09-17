import { type Locale, locales } from "@tgbox/shared";
import { launchLanguage } from "./telegram.ts";

const KEY = "tgbox-app:locale";

function isLocale(value: string | null): value is Locale {
  return locales.some((locale) => locale === value);
}

export function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Private mode: the language still applies to this document, it just isn't remembered.
  }
}

/**
 * The locale this user should see: the preference they chose (mirrored from `/api/app/me`),
 * otherwise the language their Telegram client launched us with, otherwise the page's own locale.
 */
export function preferredLocale(pageLocale: Locale): Locale {
  const stored = storedLocale();
  if (stored) return stored;
  const language = launchLanguage();
  if (language === null) return pageLocale;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
