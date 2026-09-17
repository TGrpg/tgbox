import type { Locale } from "@tgbox/shared";
import { htmlLang } from "../i18n/locale.ts";

export function formatNumber(value: number, locale: Locale, options?: { compact?: boolean }) {
  return new Intl.NumberFormat(htmlLang[locale], {
    notation: options?.compact ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Dates are rendered at build time, so pin UTC to keep output stable across machines. */
export function formatDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(htmlLang[locale], {
    year: "numeric",
    month: locale === "en" ? "short" : "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Fills `{name}` placeholders in a UI string. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
