import { getUserLocale, type Submission } from "@tgbox/db";
import type { SiteLocale } from "@tgbox/shared";
import { background, type CoreContext } from "./context.ts";
import type { RejectReason } from "./submissions.ts";

/**
 * What a submitter is told when their submission is reviewed, from the bot's review chat or the
 * admin alike: the review operation sends it, so both places say the same thing exactly once. In
 * the submitter's bot language when they chose one, else Chinese and English. The button opens
 * the Mini App's "Mine", the only place a submitter can see why they were rejected.
 */

type Words = {
  approved: (username: string) => string;
  rejected: (username: string, reason: string) => string;
  reasons: Record<RejectReason, string>;
  button: string;
};

const words: Record<SiteLocale, Words> = {
  zh: {
    approved: (u) => `🎉 你提交的 @${u} 已通过审核并收录，网站几分钟后更新。`,
    rejected: (u, reason) => `很抱歉，你提交的 @${u} 未通过审核。原因：${reason}`,
    reasons: {
      content: "内容违规",
      grey: "灰黑产",
      fake_subs: "僵尸粉",
      inactive: "长期停更",
      duplicate: "重复",
      other: "其他",
    },
    button: "📱 查看我的提交",
  },
  "zh-hant": {
    approved: (u) => `🎉 你提交的 @${u} 已通過審核並收錄，網站幾分鐘後更新。`,
    rejected: (u, reason) => `很抱歉，你提交的 @${u} 未通過審核。原因：${reason}`,
    reasons: {
      content: "內容違規",
      grey: "灰黑產",
      fake_subs: "殭屍粉",
      inactive: "長期停更",
      duplicate: "重複",
      other: "其他",
    },
    button: "📱 查看我的提交",
  },
  en: {
    approved: (u) =>
      `🎉 Your submission @${u} was approved and listed. The site updates in a few minutes.`,
    rejected: (u, reason) => `Sorry, your submission @${u} was not approved. Reason: ${reason}`,
    reasons: {
      content: "Content violation",
      grey: "Grey/black market",
      fake_subs: "Fake subscribers",
      inactive: "Inactive",
      duplicate: "Duplicate",
      other: "Other",
    },
    button: "📱 View my submissions",
  },
};

export type SubmissionOutcome = { type: "approved" } | { type: "rejected"; reason: RejectReason };

const text = (locale: SiteLocale, username: string, outcome: SubmissionOutcome) => {
  const w = words[locale];
  return outcome.type === "approved"
    ? w.approved(username)
    : w.rejected(username, w.reasons[outcome.reason]);
};

/** Tells the submitter, after the response. Best effort: the review is already recorded. */
export async function notifySubmitter(
  ctx: CoreContext,
  submission: Pick<Submission, "tgUserId" | "username">,
  outcome: SubmissionOutcome,
) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return;
  await background(ctx, async () => {
    const locale = await getUserLocale(ctx.db, submission.tgUserId);
    const body = locale
      ? text(locale, submission.username, outcome)
      : `${text("zh", submission.username, outcome)}\n\n${text("en", submission.username, outcome)}`;
    const site = ctx.config.SITE_URL?.replace(/\/+$/, "");
    // The default locale's app; it switches to the user's stored preference on open.
    const markup = site
      ? {
          reply_markup: {
            inline_keyboard: [
              [{ text: words[locale ?? "zh"].button, web_app: { url: `${site}/app/me/` } }],
            ],
          },
        }
      : {};
    const res = await ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: submission.tgUserId, text: body, ...markup }),
    });
    if (!res.ok) console.error("submitter notice failed", submission.username, res.status);
  });
}
