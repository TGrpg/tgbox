import {
  type Broadcast,
  claimBroadcastBatch,
  countAudience,
  getBroadcast,
  insertBroadcast,
  listDueBroadcasts,
  markBotUsersBlocked,
  recordBroadcastBatch,
  setBroadcastStatus,
} from "@tgbox/db";
import type { BroadcastAudience } from "@tgbox/shared";
import { z } from "zod";
import { audit } from "./audit.ts";
import type { Actor, CoreContext } from "./context.ts";

/** Telegram's free bulk limit is ~30 messages/s; one every 35 ms stays under it. */
const SEND_GAP_MS = 35;
/** Recipients per batch: under the free plan's 50 subrequests per invocation, with room for D1. */
export const BROADCAST_BATCH = 40;
/** How long a claimed batch blocks other senders if its sender dies before recording it. */
const LEASE_MS = 2 * 60 * 1000;

const SendResult = z.object({
  ok: z.boolean(),
  error_code: z.number().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

export type BroadcastMessage = {
  text: string;
  buttonText: string | null;
  buttonUrl: string | null;
};

const MessageInput = z
  .object({
    text: z.string().trim().min(1).max(4096),
    buttonText: z.string().trim().max(40).nullable(),
    buttonUrl: z
      .string()
      .trim()
      .regex(/^https:\/\/[^\s]+$/)
      .nullable(),
  })
  .refine((m) => (m.buttonText === null) === (m.buttonUrl === null));

type Sent = { ok: true } | { ok: false; blocked: boolean; retryAfterMs: number | null };

/** Plain text (no parse mode, so nothing the admin types can break formatting) + optional URL button. */
async function sendMessage(ctx: CoreContext, chatId: number, message: BroadcastMessage) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  const res = await ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.text,
      ...(message.buttonText && message.buttonUrl
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: message.buttonText, url: message.buttonUrl }]],
            },
          }
        : {}),
    }),
  });
  const body = SendResult.safeParse(await res.json().catch(() => null));
  if (body.success && body.data.ok) return { ok: true } satisfies Sent;
  const code = body.success ? body.data.error_code : res.status;
  const retryAfter = body.success ? body.data.parameters?.retry_after : undefined;
  return {
    ok: false,
    blocked: code === 403,
    retryAfterMs: code === 429 ? (retryAfter ?? 5) * 1000 : null,
  } satisfies Sent;
}

/** One message from the bot to one user (admin follow-up). A 403 marks the user as blocked. */
export async function messageUser(
  ctx: CoreContext,
  input: { tgUserId: number; message: BroadcastMessage; actor: Actor },
): Promise<{ ok: true } | { ok: false; error: "invalid" | "blocked" | "failed" }> {
  const message = MessageInput.safeParse(input.message);
  if (!message.success) return { ok: false, error: "invalid" };
  const sent = await sendMessage(ctx, input.tgUserId, message.data);
  if (!sent.ok) {
    if (sent.blocked) await markBotUsersBlocked(ctx.db, [input.tgUserId], ctx.now());
    return { ok: false, error: sent.blocked ? "blocked" : "failed" };
  }
  await audit(ctx, input.actor, "user.message", `user:${input.tgUserId}`, {
    text: message.data.text.slice(0, 200),
  });
  return { ok: true };
}

/** Starts a broadcast; the admin page and the cron then advance it batch by batch. */
export async function createBroadcast(
  ctx: CoreContext,
  input: { message: BroadcastMessage; audience: BroadcastAudience; actor: Actor },
): Promise<{ ok: true; broadcast: Broadcast } | { ok: false; error: "invalid" | "empty" }> {
  const message = MessageInput.safeParse(input.message);
  if (!message.success) return { ok: false, error: "invalid" };
  const total = await countAudience(ctx.db, input.audience);
  if (total === 0) return { ok: false, error: "empty" };
  const broadcast = await insertBroadcast(ctx.db, {
    ...message.data,
    audience: input.audience,
    total,
    createdBy: input.actor,
    now: ctx.now(),
  });
  await audit(ctx, input.actor, "broadcast.create", `broadcast:${broadcast.id}`, {
    audience: input.audience,
    total,
  });
  return { ok: true, broadcast };
}

/**
 * Sends the next batch of a running broadcast, if it is due and no other sender holds it.
 * Returns the broadcast as it stands afterwards (undefined if it doesn't exist).
 */
export async function advanceBroadcast(ctx: CoreContext, id: number, limit = BROADCAST_BATCH) {
  if (!ctx.config.BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  const broadcast = await getBroadcast(ctx.db, id);
  if (broadcast?.status !== "running" || broadcast.notBefore > ctx.now()) return broadcast;
  const recipients = await claimBroadcastBatch(ctx.db, broadcast, {
    limit,
    now: ctx.now(),
    leaseMs: LEASE_MS,
  });
  if (recipients === null) return broadcast;

  let sent = 0;
  let failed = 0;
  const blocked: number[] = [];
  let rewindTo: number | undefined;
  let notBefore: number | undefined;
  let last = 0;
  for (const [index, userId] of recipients.entries()) {
    const wait = last + SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
    const result: Sent = await sendMessage(ctx, userId, broadcast).catch((error: unknown) => {
      console.error("broadcast send failed", error);
      return { ok: false, blocked: false, retryAfterMs: null };
    });
    if (result.ok) sent++;
    else if (result.blocked) blocked.push(userId);
    else if (result.retryAfterMs !== null) {
      // Everyone from this user on goes back to the queue after Telegram's back-off.
      rewindTo = index === 0 ? broadcast.cursor : recipients[index - 1];
      notBefore = ctx.now() + result.retryAfterMs;
      break;
    } else failed++;
  }
  await markBotUsersBlocked(ctx.db, blocked, ctx.now());
  await recordBroadcastBatch(ctx.db, {
    id,
    sent,
    failed,
    blocked: blocked.length,
    rewindTo,
    notBefore,
    // A short batch that wasn't cut by a rate limit reached the end of the audience.
    done: rewindTo === undefined && recipients.length < limit,
    now: ctx.now(),
  });
  return getBroadcast(ctx.db, id);
}

const transitions = {
  pause: [["running", "paused"]],
  resume: [["paused", "running"]],
  cancel: [
    ["running", "cancelled"],
    ["paused", "cancelled"],
  ],
} as const;

/** Pause, resume or cancel; false when the broadcast wasn't in a state that allows it. */
export async function setBroadcastState(
  ctx: CoreContext,
  input: { id: number; action: keyof typeof transitions; actor: Actor },
) {
  let changed = false;
  for (const [from, to] of transitions[input.action]) {
    changed ||= await setBroadcastStatus(ctx.db, { id: input.id, from, to, now: ctx.now() });
  }
  if (changed) await audit(ctx, input.actor, `broadcast.${input.action}`, `broadcast:${input.id}`);
  return changed;
}

/**
 * Cron fallback so a broadcast finishes after the admin closes the page: one batch per due
 * broadcast within `budget` subrequests. Returns the subrequests spent.
 */
export async function runDueBroadcasts(ctx: CoreContext, budget: number) {
  let spent = 0;
  for (const broadcast of await listDueBroadcasts(ctx.db, ctx.now())) {
    const limit = Math.min(BROADCAST_BATCH, budget - spent);
    if (limit <= 0) break;
    const before = broadcast.sent + broadcast.failed + broadcast.blocked;
    const after = await advanceBroadcast(ctx, broadcast.id, limit);
    if (!after) continue;
    // Every attempt is a subrequest, including the one Telegram turned away with a 429.
    const rateLimited = after.notBefore > ctx.now();
    spent += after.sent + after.failed + after.blocked - before + (rateLimited ? 1 : 0);
  }
  return spent;
}
