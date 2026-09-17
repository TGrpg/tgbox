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
