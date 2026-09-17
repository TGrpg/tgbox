import { searchEntries } from "@tgbox/db";
import { Composer, type Context, InlineKeyboard, InlineQueryResultBuilder } from "grammy";
import type { App } from "./app.ts";
import { i18n } from "./i18n/index.ts";
import { truncate } from "./submit.ts";

const CACHE_SECONDS = 300;

export function inlineSearch(app: App) {
  const composer = new Composer<Context>();

  composer.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (!query) return;
    const m = i18n(ctx);
    const site = app.env.SITE_URL.replace(/\/$/, "");
    const rows = await searchEntries(app.db, query, 20);
    const results = rows.map(({ entry, members }) => {
      const detailUrl = `${site}/detail/${entry.username}/`;
      const telegramUrl = `https://t.me/${entry.username}`;
      const summary = [
        `@${entry.username}`,
        members === null ? null : `${m.members}: ${members.toLocaleString("en")}`,
        entry.description ? truncate(entry.description, 80) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return InlineQueryResultBuilder.article(String(entry.id), entry.title, {
        description: summary,
        reply_markup: new InlineKeyboard()
          .url(m.openTelegram, telegramUrl)
          .url(m.openSite, detailUrl),
      }).text(`${entry.title}\n${telegramUrl}\n${detailUrl}`, {
        link_preview_options: { is_disabled: true },
      });
    });
    await ctx.answerInlineQuery(results, { cache_time: CACHE_SECONDS });
  });

  return composer;
}
