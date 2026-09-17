import type { Locale } from "@tgbox/shared";
import type { Context } from "grammy";
import { en } from "./en.ts";
import { zh } from "./zh.ts";

export type Messages = typeof zh;

/**
 * Fallback when the user has no stored preference: zh for zh* language codes and anything unknown,
 * en for en*. `App.locale` layers the stored `/lang` choice on top.
 */
export function localeOf(ctx: Context): Locale {
  return ctx.from?.language_code?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function messages(locale: Locale): Messages {
  return locale === "en" ? en : zh;
}
