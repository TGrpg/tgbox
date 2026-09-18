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
import {
  type BroadcastAudience,
  type BroadcastMedia,
  type BroadcastMediaType,
  OutgoingMessage,
} from "@tgbox/shared";
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
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
  result: z.unknown().optional(),
});

type Sent =
  | { ok: true; result: unknown }
  | { ok: false; blocked: boolean; retryAfterMs: number | null; description: string | null };

const mediaMethods = {
  photo: "sendPhoto",
  video: "sendVideo",
  animation: "sendAnimation",
  document: "sendDocument",
} as const satisfies Record<BroadcastMediaType, string>;

/** Everything but the content: formatting, buttons and delivery flags, shared by every method. */
function messageOptions(message: OutgoingMessage) {
  const rows: { text: string; url: string }[][] = [];
  for (let i = 0; i < message.buttons.length; i += message.buttonsPerRow) {
    rows.push(message.buttons.slice(i, i + message.buttonsPerRow));
  }
  return {
    ...(message.format === "html" ? { parse_mode: "HTML" } : {}),
    ...(rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : {}),
    ...(message.silent ? { disable_notification: true } : {}),
    ...(message.protect ? { protect_content: true } : {}),
  };
}

async function callBotApi(ctx: CoreContext, method: string, body: BodyInit, json: boolean) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  const res = await ctx.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    ...(json ? { headers: { "content-type": "application/json" } } : {}),
    body,
  });
  const parsed = SendResult.safeParse(await res.json().catch(() => null));
  if (parsed.success && parsed.data.ok)
    return { ok: true, result: parsed.data.result } satisfies Sent;
  const code = parsed.success ? parsed.data.error_code : res.status;
  const retryAfter = parsed.success ? parsed.data.parameters?.retry_after : undefined;
  return {
    ok: false,
    blocked: code === 403,
    retryAfterMs: code === 429 ? (retryAfter ?? 5) * 1000 : null,
    description: (parsed.success ? parsed.data.description : null) ?? null,
  } satisfies Sent;
}

/** Sends a composed message; media goes by the file id Telegram gave it at upload. */
function sendOutgoing(ctx: CoreContext, chatId: number, message: OutgoingMessage) {
  const options = messageOptions(message);
  if (message.media) {
    return callBotApi(
      ctx,
      mediaMethods[message.media.type],
      JSON.stringify({
        chat_id: chatId,
        [message.media.type]: message.media.fileId,
        ...(message.text ? { caption: message.text } : {}),
        ...options,
      }),
      true,
    );
  }
  return callBotApi(
    ctx,
    "sendMessage",
    JSON.stringify({
      chat_id: chatId,
      text: message.text,
      ...(message.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
      ...options,
    }),
    true,
  );
}

const FileRef = z.object({ file_id: z.string() });
const UploadedMessage = z.object({
  photo: z.array(FileRef).optional(),
  video: FileRef.optional(),
  animation: FileRef.optional(),
  document: FileRef.optional(),
});

/**
 * Uploads a file once, by sending the composed message with it to `chatId` (the admin previewing),
 * and returns the file id every later send reuses — a broadcast never re-uploads the bytes.
 */
export async function uploadMessageMedia(
  ctx: CoreContext,
  input: {
    chatId: number;
    type: BroadcastMediaType;
    file: Blob;
    filename: string;
    message: OutgoingMessage;
  },
): Promise<{ ok: true; media: BroadcastMedia } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("chat_id", String(input.chatId));
  form.append(input.type, input.file, input.filename);
  if (input.message.text) form.append("caption", input.message.text);
  for (const [key, value] of Object.entries(messageOptions(input.message))) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const sent = await callBotApi(ctx, mediaMethods[input.type], form, false);
  if (!sent.ok) return { ok: false, error: sent.description ?? "upload failed" };
  const uploaded = UploadedMessage.safeParse(sent.result);
  // Telegram may file an upload under another type (a GIF sent as a document becomes an animation).
  const found = uploaded.success
    ? (["animation", "video", "document", "photo"] as const).flatMap((type) => {
        const ref = type === "photo" ? uploaded.data.photo?.at(-1) : uploaded.data[type];
        return ref ? [{ type, fileId: ref.file_id }] : [];
      })[0]
    : undefined;
  return found ? { ok: true, media: found } : { ok: false, error: "no file id in the reply" };
}

type SendError = "invalid" | "blocked" | "failed";

/** One message from the bot to one user. A 403 marks the user as blocked. */
async function sendToUser(
  ctx: CoreContext,
  tgUserId: number,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: SendError; description?: string }> {
  const message = OutgoingMessage.safeParse(input);
  if (!message.success) return { ok: false, error: "invalid" };
  const sent = await sendOutgoing(ctx, tgUserId, message.data);
  if (sent.ok) return { ok: true };
  if (sent.blocked) await markBotUsersBlocked(ctx.db, [tgUserId], ctx.now());
  return {
    ok: false,
    error: sent.blocked ? "blocked" : "failed",
    ...(sent.description ? { description: sent.description } : {}),
  };
}

/** Admin follow-up to one user, audited. */
export async function messageUser(
  ctx: CoreContext,
  input: { tgUserId: number; message: OutgoingMessage; actor: Actor },
) {
  const result = await sendToUser(ctx, input.tgUserId, input.message);
  if (result.ok) {
    await audit(ctx, input.actor, "user.message", `user:${input.tgUserId}`, {
      text: input.message.text.slice(0, 200),
    });
  }
  return result;
}

/** A draft sent to the admin composing it; not audited, it reaches nobody else. */
export const previewMessage = (
  ctx: CoreContext,
  input: { chatId: number; message: OutgoingMessage },
) => sendToUser(ctx, input.chatId, input.message);

/** Starts a broadcast now or at `startAt`; the admin page and the cron advance it batch by batch. */
export async function createBroadcast(
  ctx: CoreContext,
  input: {
    message: OutgoingMessage;
    audience: BroadcastAudience;
    startAt?: number | null;
    actor: Actor;
  },
): Promise<{ ok: true; broadcast: Broadcast } | { ok: false; error: "invalid" | "empty" }> {
  const message = OutgoingMessage.safeParse(input.message);
  if (!message.success) return { ok: false, error: "invalid" };
  const now = ctx.now();
  const total = await countAudience(ctx.db, input.audience, now);
  if (total === 0) return { ok: false, error: "empty" };
  const startAt = Math.max(now, input.startAt ?? now);
  const broadcast = await insertBroadcast(ctx.db, {
    ...message.data,
    audience: input.audience,
    total,
    createdBy: input.actor,
    now,
    startAt,
  });
  await audit(ctx, input.actor, "broadcast.create", `broadcast:${broadcast.id}`, {
    audience: input.audience,
    total,
    ...(startAt > now ? { startAt } : {}),
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
    const result: Sent = await sendOutgoing(ctx, userId, broadcast).catch((error: unknown) => {
      console.error("broadcast send failed", error);
      return { ok: false, blocked: false, retryAfterMs: null, description: null };
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
