import type { SiteLocale } from "@tgbox/shared";
import type { Api } from "grammy";
import { messages } from "./i18n/index.ts";

/**
 * A bot has exactly one chat menu button, and it is per-chat overridable. The global one (set in
 * BotFather) points at the user Mini App, because that is who most chats belong to; admins get a
 * per-chat override pointing at the admin panel instead.
 *
 * Same shape as `setChatCommands`: pushed on `/start` rather than on every update, because each
 * call is a Bot API request.
 */
export async function setChatMenuButton(
  api: Api,
  input: { chatId: number; url: string; locale: SiteLocale; admin: boolean },
) {
  const m = messages(input.locale);
  await api.setChatMenuButton({
    chat_id: input.chatId,
    menu_button: {
      type: "web_app",
      text: input.admin ? m.menuButtonAdmin : m.menuButtonApp,
      web_app: { url: input.url },
    },
  });
}

/**
 * `https://tgbox.cc/app/` — the Mini App is a page of the site, not a separate deployment. It has no
 * Traditional edition, so zh-hant users get the zh one.
 */
export function miniAppUrl(siteUrl: string | undefined, locale: SiteLocale) {
  if (!siteUrl) return null;
  const base = siteUrl.replace(/\/+$/, "");
  return locale === "en" ? `${base}/en/app/` : `${base}/app/`;
}
