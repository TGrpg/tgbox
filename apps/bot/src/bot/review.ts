import {
  approveSubmission,
  listApprovedSubmission,
  type RejectReason,
  rejectReasons,
  rejectSubmission,
  tgActor,
} from "@tgbox/core";
import { getSubmission } from "@tgbox/db";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { i18n, messages } from "./i18n/index.ts";

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
export async function answerAlreadyHandled(ctx: Context) {
  await ctx.answerCallbackQuery({ text: i18n(ctx).alreadyHandled, show_alert: true });
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
    await ctx.answerCallbackQuery({ text: i18n(ctx).noPermission, show_alert: true });
  });

  async function closeReview(ctx: Context, status: string) {
    const original = ctx.callbackQuery?.message?.text ?? "";
    await ctx.editMessageText(`${original}\n\n${status}`, {
      link_preview_options: { is_disabled: true },
    });
  }

  async function notifySubmitter(ctx: Context, userId: number, text: string) {
    await app.background(() => ctx.api.sendMessage(userId, text));
  }

  composer.callbackQuery(/^ra:(\d+)$/, async (ctx) => {
    const submission = await approveSubmission(app.core, {
      id: Number(ctx.match[1]),
      actor: tgActor(ctx.from.id),
    });
    if (!submission) {
      await answerAlreadyHandled(ctx);
      return;
    }
    // t.me fetches can take seconds; the webhook must answer within 10 s, so finish in waitUntil.
    // Queued before answering the callback: the submission is already approved, so a failed
    // answer (query too old) must not leave it without an entry.
    await app.background(async () => {
      // Also announces a new entry in the publish channel (see core).
      await listApprovedSubmission(app.core, submission);
      await closeReview(ctx, admin.approvedBy(reviewerName(ctx))).catch((error: unknown) =>
        console.error("closing review failed", error),
      );
      await ctx.api
        .sendMessage(submission.tgUserId, notice.approved(submission.username))
        .catch((error: unknown) => console.error("approval notice failed", error));
    });
    await ctx.answerCallbackQuery();
  });

  composer.callbackQuery(/^rj:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const submission = await getSubmission(app.db, id);
    if (submission?.status !== "pending") {
      await answerAlreadyHandled(ctx);
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
      await answerAlreadyHandled(ctx);
      return;
    }
    await notifySubmitter(ctx, submission.tgUserId, notice.rejected(submission.username, reason));
    await ctx.answerCallbackQuery();
    await closeReview(ctx, admin.rejectedBy(reviewerName(ctx), admin.reasons[reason]));
  });

  return composer;
}

// We don't know the submitter's language at review time, so notices are bilingual.
const notice = {
  approved: (username: string) =>
    `${messages("zh").approvedNotice(username)}\n\n${messages("en").approvedNotice(username)}`,
  rejected: (username: string, reason: RejectReason) =>
    `${messages("zh").rejectedNotice(username, messages("zh").admin.reasons[reason])}\n\n${messages("en").rejectedNotice(username, messages("en").admin.reasons[reason])}`,
};
