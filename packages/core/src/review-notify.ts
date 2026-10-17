import { listCategories, listTags } from "@tgbox/db";
import { reviewRecipients } from "@tgbox/shared";
import type { CoreContext } from "./context.ts";
import { getSettings } from "./settings.ts";

/** The bot's own review flow answers these; the Mini App must produce identical callback data. */
const reviewKeyboard = (submissionId: number) => ({
  inline_keyboard: [
    [
      { text: "✅ 通过", callback_data: `ra:${submissionId}` },
      { text: "🚫 拒绝", callback_data: `rj:${submissionId}` },
    ],
  ],
});

const kindNames = { channel: "频道", group: "群组", bot: "机器人" } as const;

/**
 * Tells the reviewers about a submission that did not come through the bot's own chat flow.
 *
 * The Mini App writes straight to D1, so without this a submission would sit in the queue until
 * somebody happened to open the admin panel. Sent in Chinese, like every other admin-facing
 * message. Returns how many recipients were reached.
 *
 * `BOT_TOKEN` is required; `ADMIN_IDS` / `ADMIN_CHAT_ID` decide who hears about it, exactly as in
 * the bot. Missing configuration is a no-op rather than an error — a submission that was saved
 * must never be rolled back because a notification could not go out.
 */
export async function notifyNewSubmission(
  ctx: CoreContext,
  input: {
    submissionId: number;
    username: string;
    kind: "channel" | "group" | "bot";
    title: string;
    categoryId: number;
    tagIds: number[];
    submitterId: number;
  },
): Promise<number> {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return 0;
  const settings = await getSettings(ctx);
  const { chatIds } = reviewRecipients(settings.bot, {
    ADMIN_IDS: ctx.config.ADMIN_IDS,
    ADMIN_CHAT_ID: ctx.config.ADMIN_CHAT_ID,
  });
  if (chatIds.length === 0) {
    console.error("no review chat or admins configured");
    return 0;
  }

  const [categories, tags] = await Promise.all([listCategories(ctx.db), listTags(ctx.db)]);
  const category = categories.find((row) => row.id === input.categoryId);
  const tagNames = input.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.nameZh)
    .filter((name): name is string => Boolean(name));

  const text = [
    `🆕 待审核 · ${kindNames[input.kind]} · ${category?.nameZh ?? ""}`,
    "",
    input.title,
    `@${input.username}`,
    ...(tagNames.length > 0 ? [`标签：${tagNames.join("、")}`] : []),
    "",
    `来自 Mini App · 提交者 ${input.submitterId}`,
  ].join("\n");

  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
          reply_markup: reviewKeyboard(input.submissionId),
        }),
      }),
    ),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}
