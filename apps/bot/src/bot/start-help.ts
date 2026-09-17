import { Composer, type Context, InlineKeyboard } from "grammy";
import { i18n } from "./i18n/index.ts";

export function startHelp() {
  const root = new Composer<Context>();
  const composer = root.chatType("private");

  composer.command("start", async (ctx) => {
    const m = i18n(ctx);
    await ctx.reply(m.welcome, {
      reply_markup: new InlineKeyboard().text(m.submitButton, "submit"),
    });
  });

  composer.command("help", (ctx) => ctx.reply(i18n(ctx).help));
  composer.command("submit", (ctx) => ctx.reply(i18n(ctx).sendLink));

  composer.callbackQuery("submit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(i18n(ctx).sendLink);
  });

  return root;
}
