import type { Locale } from "@tgbox/shared";
import type { Context } from "grammy";
import { en } from "./en.ts";
import { zh } from "./zh.ts";

/** zh for zh* language codes and anything unknown, en for en*. */
export function localeOf(ctx: Context): Locale {
  return ctx.from?.language_code?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function messages(locale: Locale) {
  return locale === "en" ? en : zh;
}

export function i18n(ctx: Context) {
  return messages(localeOf(ctx));
}
