import {
  approveSubmission,
  listApprovedSubmission,
  rejectReasons,
  rejectSubmission,
  tgActor,
} from "@tgbox/core";
import { getSubmission } from "@tgbox/db";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";

export function reviewKeyboard(submissionId: number) {
  const m = messages("zh").admin;
  return new InlineKeyboard()
    .text(m.approve, `ra:${submissionId}`)
    .text(m.reject, `rj:${submissionId}`);
}

/**
 * A review button on a copy that was already handled (another admin's private copy or a double
 * tap): tell the admin and drop the stale buttons from this message only.
 */
export async function answerAlreadyHandled(app: App, ctx: Context) {
  await ctx.answerCallbackQuery({ text: (await app.m(ctx)).alreadyHandled, show_alert: true });
  await ctx
    .editMessageReplyMarkup({ reply_markup: undefined })
    .catch((error: unknown) => console.error("clearing stale review buttons failed", error));
}

const reviewerName = (ctx: Context) =>
  ctx.from ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name) : "";

export function review(app: App) {
  const composer = new Composer<Context>();
  const admin = messages("zh").admin;

  composer.callbackQuery(/^r[ajrb]:/, async (ctx, next) => {
    if (await app.isAdmin(ctx)) return next();
    await ctx.answerCallbackQuery({ text: (await app.m(ctx)).noPermission, show_alert: true });
  });

  async function closeReview(ctx: Context, status: string, keyboard?: InlineKeyboard) {
    // A retry after a failed listing drops the earlier warning.
    const original = (ctx.callbackQuery?.message?.text ?? "").replace(
      `\n\n${admin.listingFailed}`,
      "",
    );
    await ctx.editMessageText(`${original}\n\n${status}`, {
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  composer.callbackQuery(/^ra:(\d+)$/, async (ctx) => {
    const actor = tgActor(ctx.from.id);
    const submission = await approveSubmission(app.core, { id: Number(ctx.match[1]), actor });
    if (!submission) {
      await answerAlreadyHandled(app, ctx);
      return;
    }
    // t.me fetches can take seconds; the webhook must answer within 10 s, so finish in waitUntil.
    // Queued before answering the callback: the submission is already approved, so a failed
    // answer (query too old) must not leave it without an entry.
    await app.background(async () => {
      // Also announces a new entry in the publish channel (see core).
      try {
        await listApprovedSubmission(app.core, submission, actor);
      } catch (error) {
        // Core put it back to pending; the buttons are still on the message, so say to retry.
        console.error("listing an approved submission failed", error);
        await closeReview(ctx, admin.listingFailed, reviewKeyboard(submission.id)).catch(
          (editError: unknown) => console.error("reporting the failed listing failed", editError),
        );
        return;
      }
      // Core told the submitter.
      await closeReview(ctx, admin.approvedBy(reviewerName(ctx))).catch((error: unknown) =>
        console.error("closing review failed", error),
      );
    });
    await ctx.answerCallbackQuery();
  });

  composer.callbackQuery(/^rj:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const submission = await getSubmission(app.db, id);
    if (submission?.status !== "pending") {
      await answerAlreadyHandled(app, ctx);
      return;
    }
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard();
    rejectReasons.forEach((reason, index) => {
      keyboard.text(admin.reasons[reason], `rr:${id}:${reason}`);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text(admin.back, `rb:${id}`);
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  composer.callbackQuery(/^rb:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: reviewKeyboard(Number(ctx.match[1])) });
  });

  composer.callbackQuery(/^rr:(\d+):(\w+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const reason = rejectReasons.find((r) => r === ctx.match[2]);
    if (!reason) {
      await ctx.answerCallbackQuery();
      return;
    }
    const submission = await rejectSubmission(app.core, {
      id,
      reason,
      actor: tgActor(ctx.from.id),
    });
    if (!submission) {
      await answerAlreadyHandled(app, ctx);
      return;
    }
    // Core told the submitter.
    await ctx.answerCallbackQuery();
    await closeReview(ctx, admin.rejectedBy(reviewerName(ctx), admin.reasons[reason]));
  });

  return composer;
}
