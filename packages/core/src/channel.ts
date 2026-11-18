import { z } from "zod";
import type { CoreContext } from "./context.ts";

const ChatMember = z.object({
  ok: z.literal(true),
  result: z.object({ status: z.string(), is_member: z.boolean().optional() }),
});

/** One `getChatMember` call; null when Telegram couldn't tell (not an admin there, network). */
async function memberStatus(ctx: CoreContext, channel: string, userId: number) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await ctx.fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: `@${channel}`, user_id: userId }),
    });
    const parsed = ChatMember.safeParse(await res.json().catch(() => null));
    if (!parsed.success) console.error("getChatMember failed", channel, res.status);
    return parsed.success ? parsed.data.result : null;
  } catch (error) {
    console.error("getChatMember failed", channel, error);
    return null;
  }
}

/**
 * Whether a user is in a public channel, from one Bot API call (no D1). "unknown" when Telegram
 * couldn't tell: callers let the user through then, so a misconfigured channel never closes
 * submissions.
 */
export async function channelMembership(ctx: CoreContext, channel: string, userId: number) {
  const member = await memberStatus(ctx, channel, userId);
  if (!member) return "unknown";
  if (member.status === "left" || member.status === "kicked") return "not_member";
  if (member.status === "restricted" && !member.is_member) return "not_member";
  return "member";
}

/** Whether the bot can see a channel's members, which only its admins can. */
export async function botAdminsChannel(ctx: CoreContext, channel: string) {
  // The bot's own user id is the token's prefix.
  const botId = Number(ctx.config.BOT_TOKEN?.split(":")[0]);
  if (!Number.isSafeInteger(botId)) return false;
  const member = await memberStatus(ctx, channel, botId);
  return member?.status === "administrator" || member?.status === "creator";
}
