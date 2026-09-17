import { z } from "zod";
import type { CoreContext } from "../context.ts";

const BotApiResponse = z.object({ ok: z.boolean(), description: z.string().optional() });

/** Refunds a Telegram Stars payment. Returns true when refunded (now or earlier). */
export async function refundStars(ctx: CoreContext, input: { userId: number; chargeId: string }) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  const res = await ctx.fetch(`https://api.telegram.org/bot${token}/refundStarPayment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: input.userId, telegram_payment_charge_id: input.chargeId }),
  });
  const body = BotApiResponse.safeParse(await res.json().catch(() => null));
  if (body.success && body.data.ok) return true;
  const description = body.success ? body.data.description : undefined;
  if (description?.includes("CHARGE_ALREADY_REFUNDED")) return true;
  console.error("refundStarPayment failed", res.status, description);
  return false;
}

const InvoiceLink = z.object({ ok: z.literal(true), result: z.string() });

/**
 * A Stars invoice the Mini App can open with `Telegram.WebApp.openInvoice`. The bot sends its
 * invoices into the chat instead (`sendInvoice`), but both carry the same `order:<id>` payload,
 * so a payment settles through the same `pre_checkout_query` / `successful_payment` handlers.
 */
export async function createStarsInvoiceLink(
  ctx: CoreContext,
  input: { title: string; description: string; payload: string; amount: number },
) {
  const token = ctx.config.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not configured");
  const res = await ctx.fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Telegram truncates silently; cut at its documented limits so the invoice reads as intended.
      title: input.title.slice(0, 32),
      description: input.description.slice(0, 255),
      payload: input.payload,
      currency: "XTR",
      prices: [{ label: input.title.slice(0, 32), amount: input.amount }],
    }),
  });
  const body = InvoiceLink.safeParse(await res.json().catch(() => null));
  if (body.success) return body.data.result;
  console.error("createInvoiceLink failed", res.status);
  return null;
}
