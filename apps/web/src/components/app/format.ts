import type { Locale, PaymentCurrency } from "@tgbox/shared";
import { htmlLang } from "@/i18n/locale.ts";
import { formatDate } from "@/lib/format.ts";

/** The API speaks epoch milliseconds; the site's formatter takes ISO strings. */
export const appDate = (ms: number, locale: Locale) =>
  formatDate(new Date(ms).toISOString(), locale);

/** A deadline needs the time of day, and the app runs on the visitor's device, so local time it is. */
export const appDateTime = (ms: number, locale: Locale) =>
  new Intl.DateTimeFormat(htmlLang[locale], { dateStyle: "short", timeStyle: "short" }).format(
    new Date(ms),
  );

export function appAmount(amount: string | null, currency: PaymentCurrency | null) {
  if (amount === null) return "—";
  return currency === "XTR" ? `${amount} ⭐` : `${amount} ${currency ?? ""}`.trim();
}
