import { clearUserLocale, deleteBotDraft, setUserLocale } from "@tgbox/db";
import { type Locale, locales } from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { setChatCommands } from "./commands.ts";
import { localeOf, messages } from "./i18n/index.ts";
import { relayEnabled } from "./support.ts";

export function startHelp(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  composer.command("start", async (ctx, next) => {
    // Deep links: ?start=submit asks for a link here, ?start=promote is handled by `promote`.
    if (ctx.match === "promote") return next();
    if (ctx.match === "submit") return askForLink(ctx);
    const locale = await app.locale(ctx);
    const m = messages(locale);
    const custom = (await app.settings()).bot.welcome[locale];
    await ctx.reply(custom || m.welcome, {
      reply_markup: new InlineKeyboard()
        .text(m.submitButton, "submit")
        .text(m.promoteButton, "promote")
        .row()
        .text(m.langButton, "lang"),
    });
  });

  composer.command("help", async (ctx) => ctx.reply((await app.m(ctx)).help));

  composer.command("support", async (ctx) => {
    const m = await app.m(ctx);
    const bot = (await app.settings()).bot;
    await ctx.reply(relayEnabled(bot) ? m.supportChat.ask : m.support(bot.supportUsername));
  });

  /* ------------------------------------------------------------------ /lang */

  const langKeyboard = (m: ReturnType<typeof messages>) =>
    new InlineKeyboard()
      .text(m.lang.zh, "lang:zh")
      .text(m.lang.en, "lang:en")
      .row()
      .text(m.lang.auto, "lang:auto");

  async function askForLanguage(ctx: Context) {
    const m = await app.m(ctx);
    await ctx.reply(m.lang.choose, { reply_markup: langKeyboard(m) });
  }

  composer.command("lang", askForLanguage);
  composer.callbackQuery("lang", async (ctx) => {
    await ctx.answerCallbackQuery();
    await askForLanguage(ctx);
  });

  composer.callbackQuery(/^lang:(zh|en|auto)$/, async (ctx) => {
    const choice = ctx.match[1];
    const picked: Locale | undefined = locales.find((locale) => locale === choice);
    if (picked) await setUserLocale(app.db, ctx.from.id, picked, app.now());
    else await clearUserLocale(app.db, ctx.from.id);
    await ctx.answerCallbackQuery();
    // The command menu follows the Telegram app language, so it is overridden for this chat only.
    await setChatCommands(ctx.api, ctx.from.id, picked ?? null).catch((error: unknown) =>
      console.error("setting the chat command menu failed", error),
    );
    // Confirmed in the language the user just chose ("auto" falls back to the client language).
    const m = messages(picked ?? localeOf(ctx));
    await ctx.editMessageText(picked ? m.lang.saved : m.lang.savedAuto).catch(() => {});
  });

  /* ---------------------------------------------------------------- /submit */

  async function askForLink(ctx: Context) {
    const m = await app.m(ctx);
    if (!(await app.settings()).bot.submissionsOpen) {
      await ctx.reply(m.submissionsClosed);
      return;
    }
    // Leaves an unfinished promotion purchase, whose steps would otherwise take the link as input.
    if (ctx.from) await deleteBotDraft(app.db, ctx.from.id);
    await ctx.reply(m.sendLink);
  }

  composer.command("submit", askForLink);
  composer.callbackQuery("submit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await askForLink(ctx);
  });

  return root;
}
