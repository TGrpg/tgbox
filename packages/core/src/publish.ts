import { getEntryByUsername, listCategories } from "@tgbox/db";
import type { CoreContext } from "./context.ts";
import { getSettings } from "./settings.ts";

const kindNames = { channel: "频道", group: "群组", bot: "机器人" } as const;

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Announces a newly listed entry in the publish channel (Chinese, the site's default locale).
 * No-op without a channel, BOT_TOKEN or SITE_URL. Returns whether a message was sent.
 */
export async function publishEntryToChannel(ctx: CoreContext, input: { username: string }) {
  const { BOT_TOKEN: token, SITE_URL: siteUrl } = ctx.config;
  const channelId = (await getSettings(ctx)).bot.publishChannelId;
  if (!channelId || !token || !siteUrl) return false;
  const entry = await getEntryByUsername(ctx.db, input.username);
  if (!entry) return false;
  const category = (await listCategories(ctx.db)).find((row) => row.id === entry.categoryId);
  const url = `${siteUrl.replace(/\/$/, "")}/detail/${entry.username}/`;
  const description = truncate(entry.description, 200);
  const text = [
    `🆕 新收录 · ${kindNames[entry.kind]} · ${category?.nameZh ?? ""}`,
    "",
    entry.title,
    `@${entry.username}`,
    ...(description ? ["", description] : []),
    "",
    url,
  ].join("\n");
  const res = await ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: channelId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "打开 Telegram", url: `https://t.me/${entry.username}` },
            { text: "网站详情", url },
          ],
        ],
      },
    }),
  });
  if (!res.ok) {
    console.error("publishing entry failed", entry.username, res.status, await res.text());
    return false;
  }
  return true;
}
