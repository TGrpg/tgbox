import type { SiteLocale } from "@tgbox/shared";
import type { Context } from "grammy";
import { en } from "./en.ts";
import { zh } from "./zh.ts";
import { hantNames, zhHant } from "./zh-hant.gen.ts";

export type Messages = typeof zh;

/**
 * Fallback when the user has no stored preference: en for en* language codes, zh-hant for
 * Traditional clients (zh-hant, zh-tw, zh-hk, zh-mo), zh for other zh* codes and anything unknown.
 * `App.locale` layers the stored `/lang` choice on top.
 */
export function localeOf(ctx: Context): SiteLocale {
  const code = ctx.from?.language_code?.toLowerCase() ?? "";
  if (code.startsWith("en")) return "en";
  return /^zh-(hant|tw|hk|mo)\b/.test(code) ? "zh-hant" : "zh";
}

export function messages(locale: SiteLocale): Messages {
  return locale === "en" ? en : locale === "zh-hant" ? zhHant : zh;
}

/**
 * A category, tag or product name in the user's language. Traditional names cover the seed
 * taxonomy; a name an admin has renamed since falls back to its Simplified form.
 */
export function localName(item: { nameZh: string; nameEn: string }, locale: SiteLocale): string {
  if (locale === "en") return item.nameEn;
  return locale === "zh-hant" ? (hantNames[item.nameZh] ?? item.nameZh) : item.nameZh;
}
