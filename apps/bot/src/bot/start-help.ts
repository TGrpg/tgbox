import { deleteBotDraft } from "@tgbox/db";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { i18n, localeOf } from "./i18n/index.ts";

export function startHelp(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  composer.command("start", async (ctx, next) => {
    // Deep links: ?start=submit asks for a link here, ?start=promote is handled by `promote`.
    if (ctx.match === "promote") return next();
    if (ctx.match === "submit") return askForLink(ctx);
    const m = i18n(ctx);
    const custom = (await app.settings()).bot.welcome[localeOf(ctx)];
    await ctx.reply(custom || m.welcome, {
      reply_markup: new InlineKeyboard()
        .text(m.submitButton, "submit")
        .text(m.promoteButton, "promote"),
    });
  });

  composer.command("help", (ctx) => ctx.reply(i18n(ctx).help));

  composer.command("support", async (ctx) => {
    await ctx.reply(i18n(ctx).support((await app.settings()).bot.supportUsername));
  });

  async function askForLink(ctx: Context) {
    const m = i18n(ctx);
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
