import { clearUserLocale, deleteBotDraft, setUserLocale } from "@tgbox/db";
import { type SiteLocale, siteLocales, textLocale } from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { setChatCommands } from "./commands.ts";
import { localeOf, messages } from "./i18n/index.ts";
import { miniAppUrl, setChatMenuButton } from "./menu-button.ts";
import { relayEnabled } from "./support.ts";

export function startHelp(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  /**
   * The menu button is a single per-bot slot, overridable per chat: the app for everyone, the admin
   * panel for admins. Pushed on `/start` rather than per update, since each call is an API request —
   * and on every `/start`, deep links included, because a visitor arriving from the website's
   * `?start=submit` link is exactly the person who has never had the button set.
   */
  async function pushMenuButton(ctx: Context, locale: SiteLocale) {
    const appUrl = miniAppUrl(app.env.SITE_URL, locale);
    if (!appUrl || !ctx.chat) return;
    const chatId = ctx.chat.id;
    const adminUrl = app.env.ADMIN_URL;
    const admin = Boolean(adminUrl) && (await app.isAdmin(ctx));
    await app.background(() =>
      setChatMenuButton(app.api, {
        chatId,
        url: admin && adminUrl ? adminUrl : appUrl,
        locale,
        admin,
      }),
    );
  }

  composer.command("start", async (ctx, next) => {
    const locale = await app.locale(ctx);
    await pushMenuButton(ctx, locale);
    // Deep links: ?start=submit asks for a link here, ?start=promote is handled by `promote`,
    // ?start=links by `friendLinks`, ?start=support is the Mini App's contact button.
    if (ctx.match === "promote" || ctx.match === "links") return next();
    if (ctx.match === "submit") return askForLink(ctx);
    if (ctx.match === "support") return support(ctx);
    const m = messages(locale);
    const custom = (await app.settings()).bot.welcome[textLocale(locale)];
    const appUrl = miniAppUrl(app.env.SITE_URL, locale);
    const keyboard = new InlineKeyboard()
      .text(m.submitButton, "submit")
      .text(m.promoteButton, "promote")
      .row();
    if (appUrl) keyboard.webApp(m.openApp, appUrl).row();
    keyboard.text(m.langButton, "lang");
    await ctx.reply(custom || m.welcome, { reply_markup: keyboard });
  });

  composer.command("help", async (ctx) => ctx.reply((await app.m(ctx)).help));

  async function support(ctx: Context) {
    const m = await app.m(ctx);
    const bot = (await app.settings()).bot;
    await ctx.reply(relayEnabled(bot) ? m.supportChat.ask : m.support(bot.supportUsername));
  }

  composer.command("support", support);

  /* ------------------------------------------------------------------ /lang */

  const langKeyboard = (m: ReturnType<typeof messages>) =>
    new InlineKeyboard()
      .text(m.lang.zh, "lang:zh")
      .text(m.lang.zhHant, "lang:zh-hant")
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

  composer.callbackQuery(/^lang:(zh|zh-hant|en|auto)$/, async (ctx) => {
    const choice = ctx.match[1];
    const picked: SiteLocale | undefined = siteLocales.find((locale) => locale === choice);
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
