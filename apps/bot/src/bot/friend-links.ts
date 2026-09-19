import { applyForFriendLink, approveFriendLink, rejectFriendLink, tgActor } from "@tgbox/core";
import { deleteBotDraft, getBotDraft, putBotDraft } from "@tgbox/db";
import { FriendLink, type SiteLocale } from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";
import { answerAlreadyHandled } from "./review.ts";

const linkSteps = ["link_url", "link_name", "link_description"] as const;
type LinkStep = (typeof linkSteps)[number];
type LinkDraft = { url?: string; name?: string };

/** Only drafts written by this flow; the others are left to their own composers. */
function parseLinkDraft(step: string, payload: unknown) {
  const linkStep = linkSteps.find((s) => s === step);
  if (!linkStep || typeof payload !== "object" || payload === null) return null;
  const p: Record<string, unknown> = { ...payload };
  const draft: LinkDraft = {};
  if (typeof p.url === "string") draft.url = p.url;
  if (typeof p.name === "string") draft.name = p.name;
  return { step: linkStep, draft };
}

const Description = FriendLink.shape.descZh.min(1);

const reviewer = (ctx: Context) =>
  ctx.from ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name) : "";

/** Link-exchange applications: `?start=links` asks three questions, admins approve in chat. */
export function friendLinks(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");
  const cancelKeyboard = (locale: SiteLocale) =>
    new InlineKeyboard().text(messages(locale).cancel, "lx");

  async function askForUrl(ctx: Context & { from: { id: number } }) {
    const locale = await app.locale(ctx);
    await putBotDraft(app.db, {
      tgUserId: ctx.from.id,
      step: "link_url",
      payload: {},
      updatedAt: app.now(),
    });
    const siteUrl = `${app.env.SITE_URL}${locale === "en" ? "/en" : ""}/`;
    await ctx.reply(messages(locale).friendLink.askUrl(siteUrl), {
      reply_markup: cancelKeyboard(locale),
      link_preview_options: { is_disabled: true },
    });
  }

  // Deep link https://t.me/<bot>?start=links from the site footer and /links/; `startHelp` passes it on.
  composer.command("start", async (ctx, next) => (ctx.match === "links" ? askForUrl(ctx) : next()));

  composer.callbackQuery("lx", async (ctx) => {
    await deleteBotDraft(app.db, ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText((await app.m(ctx)).friendLink.cancelled).catch(() => {});
  });

  composer.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    const userId = ctx.from.id;
    const row = await getBotDraft(app.db, userId, app.now());
    const current = row ? parseLinkDraft(row.step, row.payload) : null;
    if (!current) return next();

    const locale = await app.locale(ctx);
    const m = messages(locale).friendLink;
    const { step, draft } = current;
    const again = (message: string) => ctx.reply(message, { reply_markup: cancelKeyboard(locale) });
    const advance = async (nextStep: LinkStep, next: LinkDraft, prompt: string) => {
      await putBotDraft(app.db, {
        tgUserId: userId,
        step: nextStep,
        payload: next,
        updatedAt: app.now(),
      });
      await again(prompt);
    };

    if (step === "link_url") {
      const url = FriendLink.shape.url.safeParse(text);
      if (!url.success) return void (await again(m.invalidUrl));
      return advance("link_name", { url: url.data }, m.askName);
    }
    if (step === "link_name") {
      const name = FriendLink.shape.name.safeParse(text);
      if (!name.success) return void (await again(m.invalidName));
      return advance("link_description", { ...draft, name: name.data }, m.askDescription);
    }

    const description = Description.safeParse(text);
    if (!description.success) return void (await again(m.invalidDescription));
    if (!draft.url || !draft.name) {
      await deleteBotDraft(app.db, userId);
      return askForUrl(ctx);
    }
    await deleteBotDraft(app.db, userId);
    const applied = await applyForFriendLink(app.core, {
      tgUserId: userId,
      url: draft.url,
      name: draft.name,
      description: description.data,
    });
    if (!applied.ok) return void (await ctx.reply(m[applied.error]));
    const { request } = applied;
    await ctx.reply(m.submitted(request.backlink));
    const admin = messages("zh").admin;
    await app.sendReview(
      admin.friendLinkReview({
        id: request.id,
        name: request.name,
        url: request.url,
        description: request.description,
        backlink: request.backlink,
        applicantId: userId,
        applicantUsername: ctx.from.username ?? null,
      }),
      {
        link_preview_options: { is_disabled: true },
        reply_markup: new InlineKeyboard()
          .text(admin.approve, `fa:${request.id}`)
          .text(admin.reject, `fj:${request.id}`),
      },
    );
  });

  /* ------------------------------------------------------------------ review */

  root.callbackQuery(/^f[aj]:/, async (ctx, next) => {
    if (await app.isAdmin(ctx)) return next();
    await ctx.answerCallbackQuery({ text: (await app.m(ctx)).noPermission, show_alert: true });
  });

  async function closeReview(ctx: Context, status: string) {
    const original = ctx.callbackQuery?.message?.text ?? "";
    await ctx
      .editMessageText(`${original}\n\n${status}`, { link_preview_options: { is_disabled: true } })
      .catch((error: unknown) => console.error("closing link review failed", error));
  }

  root.callbackQuery(/^fa:(\d+)$/, async (ctx) => {
    const result = await approveFriendLink(app.core, {
      id: Number(ctx.match[1]),
      actor: tgActor(ctx.from.id),
    });
    if (!result) return answerAlreadyHandled(app, ctx);
    const admin = messages("zh").admin;
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: admin.friendLinksFull, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await closeReview(ctx, admin.approvedBy(reviewer(ctx)));
  });

  root.callbackQuery(/^fj:(\d+)$/, async (ctx) => {
    const request = await rejectFriendLink(app.core, {
      id: Number(ctx.match[1]),
      actor: tgActor(ctx.from.id),
    });
    if (!request) return answerAlreadyHandled(app, ctx);
    await ctx.answerCallbackQuery();
    await closeReview(ctx, messages("zh").admin.friendLinkRejectedBy(reviewer(ctx)));
  });

  return root;
}
