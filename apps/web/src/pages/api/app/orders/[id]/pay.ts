import { createStarsInvoiceLink, getSettings, quoteUsdtOrder } from "@tgbox/core";
import { getOrder, getProduct, getUserLocale } from "@tgbox/db";
import { PayRequest, type PayResult } from "@tgbox/shared";
import type { APIRoute } from "astro";
import { appError, appJson, authenticateApp, jsonBody } from "@/lib/app-auth.ts";

export const prerender = false;

/**
 * Pays for a pending order. Stars get an invoice link the app opens with
 * `Telegram.WebApp.openInvoice` (the bot sends the same invoice into the chat instead); USDT gets
 * the address and the exact amount that identifies the transfer, quoted by the same
 * `quoteUsdtOrder` the bot uses, so a buyer who starts in one place can finish in the other.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const auth = await authenticateApp(request);
  if (!auth.ok) return auth.response;
  const { user, db, core } = auth.session;

  const orderId = Number(params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return appError("not_found", 404);
  const input = PayRequest.safeParse(await jsonBody(request));
  if (!input.success) return appError("invalid");

  const order = await getOrder(db, orderId);
  // Ownership comes from the verified initData, so an id guessed from the URL buys nothing.
  if (!order || order.tgUserId !== user.id) return appError("not_found", 404);
  if (order.status !== "pending") return appError("order_expired");
  const product = await getProduct(db, order.productId);
  if (!product) return appError("product_unavailable");

  if (input.data.method === "usdt") {
    const quote = await quoteUsdtOrder(core, { orderId: order.id, productId: order.productId });
    if (!quote.ok) return appError(quote.error);
    return appJson({
      ok: true,
      method: "usdt",
      address: quote.quote.address,
      amount: quote.quote.amount,
      expiresAt: quote.quote.expiresAt,
    } satisfies PayResult);
  }

  const { payments } = await getSettings(core);
  if (!payments.starsEnabled) return appError("no_payment_method");
  const locale = (await getUserLocale(db, user.id)) ?? "zh";
  const name = locale === "en" ? product.nameEn : product.nameZh;
  const link = await createStarsInvoiceLink(core, {
    title: name,
    // Kept language-neutral on purpose: the invoice is a Telegram surface, not ours to translate.
    description: [name, `${order.days}d`, order.targetUsername && `@${order.targetUsername}`]
      .filter(Boolean)
      .join(" · "),
    // Same payload the bot's invoices carry, so `successful_payment` settles both identically.
    payload: `order:${order.id}`,
    amount: product.priceStars,
  }).catch((error: unknown) => {
    console.error("stars invoice failed", order.id, error);
    return null;
  });
  if (!link) return appError("invoice_failed");
  return appJson({ ok: true, method: "stars", invoiceLink: link } satisfies PayResult);
};
