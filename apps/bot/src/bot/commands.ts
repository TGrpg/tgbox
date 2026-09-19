import type { SiteLocale } from "@tgbox/shared";
import type { Api } from "grammy";
import type { BotCommand } from "grammy/types";
import { messages } from "./i18n/index.ts";

/** Menu order, shortest path to a listing first. */
const menu = ["submit", "promote", "support", "lang", "help"] as const;

/** The command menu for one language. Descriptions live in the bot i18n files. */
export function botCommands(locale: SiteLocale): BotCommand[] {
  const { commands } = messages(locale);
  return menu.map((command) => ({ command, description: commands[command] }));
}

/**
 * Telegram picks the menu from the user's *app* language, not from our stored `/lang` preference,
 * so a choice is pushed to that one chat. `null` ("auto") removes the override and the global
 * lists — set once at deploy time with `botCommands` — apply again.
 */
export async function setChatCommands(api: Api, chatId: number, locale: SiteLocale | null) {
  const scope = { type: "chat", chat_id: chatId } as const;
  if (locale === null) await api.deleteMyCommands({ scope });
  else await api.setMyCommands(botCommands(locale), { scope });
}
