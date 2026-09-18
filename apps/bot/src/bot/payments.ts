import {
  approveAdOrder,
  checkOrderSlots,
  markOrderPaid,
  refundStars,
  rejectOrder,
  tgActor,
} from "@tgbox/core";
import { getOrder, getProduct, type Order } from "@tgbox/db";
import {
  isEntryProduct,
  type Locale,
  type PaymentCurrency,
  type PaymentProvider,
} from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";
import { orderTarget } from "./promote.ts";
import { answerAlreadyHandled } from "./review.ts";

type Messages = ReturnType<typeof messages>;

/** `order:<id>` → id */
export function parseOrderPayload(payload: string | null | undefined) {
  const match = /^order:(\d+)$/.exec(payload ?? "");
  return match ? Number(match[1]) : null;
}

/** The buyer's language when known (in-bot payments), else both languages. */
function localized(locale: Locale | null, text: (m: Messages) => string) {
  return locale ? text(messages(locale)) : `${text(messages("zh"))}\n\n${text(messages("en"))}`;
}

const reviewer = (ctx: Context) =>
  ctx.from ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name) : "";

/**
 * Records a payment from either provider and sends the follow-up messages in the background:
 * pins are live (buyer told), banners go to the review chat. A payment for an order that is gone
 * or already paid by another charge is refunded (Stars) or flagged to the review chat.
 */
export async function recordPayment(
  app: App,
  input: {
    orderId: number;
    provider: PaymentProvider;
    chargeId: string;
    amount: string;
    currency: PaymentCurrency;
    buyerId: number | null;
    locale: Locale | null;
  },
) {
  const { buyerId: _buyerId, locale: _locale, ...payment } = input;
  const result = await markOrderPaid(app.core, payment);
  const orphan = !result || (!result.changed && result.order.chargeId !== input.chargeId);
  if (orphan) {
    await app.background(() => handleOrphanPayment(app, input));
    return;
  }
  if (!result.changed) return;
  const { order } = result;
  await app.background(async () => {
    const buyerText = isEntryProduct(order.kind)
      ? localized(input.locale, (l) => l.promote.paidEntry(orderTarget(order), order.days))
      : localized(input.locale, (l) => l.promote.paidAd);
    await app.api
      .sendMessage(order.tgUserId, buyerText)
      .catch((error: unknown) => console.error("payment notice failed", error));
    if (!isEntryProduct(order.kind)) await sendAdReview(app, order);
  });
}

async function handleOrphanPayment(app: App, input: Parameters<typeof recordPayment>[1]) {
  console.error("payment for an order that is not pending", input);
  if (input.provider === "stars" && input.buyerId !== null) {
    const refunded = await refundStars(app.core, {
      userId: input.buyerId,
      chargeId: input.chargeId,
    });
    if (refunded) {
      await app.api.sendMessage(
        input.buyerId,
        localized(input.locale, (m) => m.promote.orphanRefunded),
      );
      return;
    }
  }
  await app.sendReview(
    messages("zh").admin.orphanPayment(
      input.orderId,
      input.provider,
      input.chargeId,
      `${input.amount} ${input.currency}`,
    ),
  );
}

async function sendAdReview(app: App, order: Order) {
  if (!order.banner) {
    console.error("ad order without content", order.id);
    return;
  }
  const product = await getProduct(app.db, order.productId);
  const m = messages("zh").admin;
  await app.sendReview(
    m.adReview({
      id: order.id,
      product: product?.nameZh ?? String(order.productId),
      ...order.banner,
      amount: order.amount ?? "",
      currency: order.currency ?? "",
      buyerId: order.tgUserId,
    }),
    {
      link_preview_options: { is_disabled: true },
      reply_markup: new InlineKeyboard()
        .text(m.approve, `ba:${order.id}`)
        .text(m.reject, `bj:${order.id}`),
    },
  );
}

export function payments(app: App) {
  const composer = new Composer<Context>();

  composer.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const m = (await app.m(ctx)).promote;
    const orderId = parseOrderPayload(query.invoice_payload);
    const order = orderId === null ? undefined : await getOrder(app.db, orderId);
    const product = order ? await getProduct(app.db, order.productId) : undefined;
    const valid =
      order?.status === "pending" &&
      order.tgUserId === query.from.id &&
      query.currency === "XTR" &&
      query.total_amount === product?.priceStars;
    if (!valid || !order) {
      await ctx.answerPreCheckoutQuery(false, { error_message: m.checkoutInvalid });
      return;
    }
    if ((await checkOrderSlots(app.core, order)).available === 0) {
      await ctx.answerPreCheckoutQuery(false, { error_message: m.checkoutNoSlots });
      return;
    }
    await ctx.answerPreCheckoutQuery(true);
  });

  composer.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const orderId = parseOrderPayload(payment.invoice_payload);
    if (orderId === null || payment.currency !== "XTR") {
      console.error("unexpected successful_payment", payment);
      return;
    }
    await recordPayment(app, {
      orderId,
      provider: "stars",
      chargeId: payment.telegram_payment_charge_id,
      amount: String(payment.total_amount),
      currency: "XTR",
      buyerId: ctx.from?.id ?? null,
      locale: await app.locale(ctx),
    });
  });

  composer.callbackQuery(/^b[aj]:/, async (ctx, next) => {
    if (await app.isAdmin(ctx)) return next();
    await ctx.answerCallbackQuery({ text: (await app.m(ctx)).noPermission, show_alert: true });
  });

  async function closeReview(ctx: Context, status: string) {
    const original = ctx.callbackQuery?.message?.text ?? "";
    await ctx
      .editMessageText(`${original}\n\n${status}`, { link_preview_options: { is_disabled: true } })
      .catch((error: unknown) => console.error("closing banner review failed", error));
  }

  composer.callbackQuery(/^ba:(\d+)$/, async (ctx) => {
    const order = await approveAdOrder(app.core, {
      orderId: Number(ctx.match[1]),
      actor: tgActor(ctx.from.id),
    });
    if (!order) {
      await answerAlreadyHandled(app, ctx);
      return;
    }
    const endsAt = order.endsAt ?? app.now();
    await app.background(() =>
      app.api.sendMessage(
        order.tgUserId,
        localized(null, (m) => m.promote.adApproved(orderTarget(order), endsAt)),
      ),
    );
    await ctx.answerCallbackQuery();
    await closeReview(ctx, messages("zh").admin.approvedBy(reviewer(ctx)));
  });

  composer.callbackQuery(/^bj:(\d+)$/, async (ctx) => {
    const result = await rejectOrder(app.core, {
      orderId: Number(ctx.match[1]),
      actor: tgActor(ctx.from.id),
    });
    if (!result) {
      await answerAlreadyHandled(app, ctx);
      return;
    }
    const { order, refunded } = result;
    const support = (await app.settings()).bot.supportUsername;
    await app.background(() =>
      app.api.sendMessage(
        order.tgUserId,
        localized(null, (m) =>
          refunded ? m.promote.adRejectedRefunded : m.promote.adRejectedManual(order.id, support),
        ),
      ),
    );
    await ctx.answerCallbackQuery();
    await closeReview(
      ctx,
      messages("zh").admin.adRejected(
        reviewer(ctx),
        refunded,
        `${order.amount ?? ""} ${order.currency ?? ""}`.trim(),
      ),
    );
  });

  return composer;
}
