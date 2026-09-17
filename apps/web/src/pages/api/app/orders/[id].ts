import { getOrder } from "@tgbox/db";
import type { OrderStatusResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appError, appJson, authenticateApp } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Whether an order has been paid yet. Polled (every 2s) only while a USDT payment screen is open,
 * because an on-chain transfer is confirmed by the bot's cron, not by a callback the app can await.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, db } = auth.session;

  const orderId = Number(params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return appError("not_found", 404);

  const order = await getOrder(db, orderId);
  // Someone else's order is reported as missing: order ids are sequential, so confirming that one
  // exists would leak how many have been sold.
  if (!order || order.tgUserId !== user.id) return appError("not_found", 404);

  return appJson({ status: order.status, paidAt: order.paidAt } satisfies OrderStatusResult);
};
