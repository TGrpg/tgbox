import {
  checkSlots,
  createCryptoPayInvoice,
  createOrder,
  getCredential,
  hasCredential,
} from "@tgbox/core";
import {
  deleteBotDraft,
  getBotDraft,
  getOrder,
  getProduct,
  listProducts,
  type Order,
  type Product,
  putBotDraft,
  setOrderInvoice,
} from "@tgbox/db";
import { BannerContent, type Locale, parseTelegramRef } from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";

const promoteSteps = [
  "promote_target",
  "promote_title",
  "promote_subtitle",
  "promote_href",
] as const;
type PromoteStep = (typeof promoteSteps)[number];

type PromoteDraft = { productId: number; title?: string; subtitle?: string };

/** Only drafts written by this flow; submission drafts are left to `submit`. */
function parsePromoteDraft(step: string, payload: unknown) {
  const promoteStep = promoteSteps.find((s) => s === step);
  if (!promoteStep || typeof payload !== "object" || payload === null) return null;
  const p: Record<string, unknown> = { ...payload };
  if (typeof p.productId !== "number") return null;
  const draft: PromoteDraft = { productId: p.productId };
  if (typeof p.title === "string") draft.title = p.title;
  if (typeof p.subtitle === "string") draft.subtitle = p.subtitle;
  return { step: promoteStep, draft };
}

export const productName = (locale: Locale, product: Product) =>
  locale === "en" ? product.nameEn : product.nameZh;

export const orderTarget = (order: Pick<Order, "targetUsername" | "banner">) => ({
  username: order.targetUsername,
  bannerTitle: order.banner?.title ?? null,
});

/** Stars when enabled; USDT when enabled and a Crypto Pay token can be decrypted. */
async function paymentMethods(app: App) {
  const { payments } = await app.settings();
  const usdt =
    payments.cryptoPayEnabled &&
    Boolean(app.env.SETTINGS_KEY) &&
    (await hasCredential(app.core, "cryptopay_token"));
  return { stars: payments.starsEnabled, usdt };
}

export function promote(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");
  const cancelKeyboard = (locale: Locale) =>
    new InlineKeyboard().text(messages(locale).cancel, "px");

  async function showProducts(ctx: Context) {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const [products, methods] = await Promise.all([
      listProducts(app.db, { activeOnly: true }),
      paymentMethods(app),
    ]);
    if (products.length === 0 || !(methods.stars || methods.usdt)) {
      await ctx.reply(m.unavailable);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const product of products) {
      const label = m.product({
        name: productName(locale, product),
        days: product.days,
        stars: product.priceStars,
        usdt: product.priceUsdt,
      });
      keyboard.text(label, `pp:${product.id}`).row();
    }
    await ctx.reply(m.intro, { reply_markup: keyboard });
  }

  composer.command("promote", showProducts);
  // Deep link https://t.me/<bot>?start=promote; `startHelp` passes it on.
  composer.command("start", async (ctx, next) =>
    ctx.match === "promote" ? showProducts(ctx) : next(),
  );
  composer.callbackQuery("promote", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProducts(ctx);
  });

  composer.callbackQuery(/^pp:(\d+)$/, async (ctx) => {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const product = await getProduct(app.db, Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
    if (!product?.active) {
      await ctx.reply(m.productUnavailable);
      return;
    }
    // Checked up front so nobody fills in a banner only to hear the slots are gone.
    const slots = await checkSlots(app.core, product.kind);
    if (slots.available === 0) {
      await ctx.reply(m.noSlots(slots.nextFreeAt));
      return;
    }
    const step: PromoteStep = product.kind === "pin" ? "promote_target" : "promote_title";
    const draft: PromoteDraft = { productId: product.id };
    await putBotDraft(app.db, {
      tgUserId: ctx.from.id,
      step,
      payload: draft,
      updatedAt: app.now(),
    });
    await ctx.reply(product.kind === "pin" ? m.askTarget : m.askTitle, {
      reply_markup: cancelKeyboard(locale),
    });
  });

  composer.callbackQuery("px", async (ctx) => {
    await deleteBotDraft(app.db, ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText((await app.m(ctx)).promote.cancelled).catch(() => {});
  });

  composer.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const userId = ctx.from.id;
    const row = await getBotDraft(app.db, userId, app.now());
    const current = row ? parsePromoteDraft(row.step, row.payload) : null;
    if (!current) return next();

    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const text = ctx.message.text.trim();
    const { step, draft } = current;
    const again = (message: string) => ctx.reply(message, { reply_markup: cancelKeyboard(locale) });
    const advance = async (nextStep: PromoteStep, next: PromoteDraft, prompt: string) => {
      await putBotDraft(app.db, {
        tgUserId: userId,
        step: nextStep,
        payload: next,
        updatedAt: app.now(),
      });
      await again(prompt);
    };

    if (step === "promote_title") {
      const title = BannerContent.shape.title.safeParse(text);
      if (!title.success) {
        await again(m.invalidTitle);
        return;
      }
      return advance("promote_subtitle", { ...draft, title: title.data }, m.askSubtitle);
    }
    if (step === "promote_subtitle") {
      const subtitle = BannerContent.shape.subtitle.safeParse(text);
      if (!subtitle.success) {
        await again(m.invalidSubtitle);
        return;
      }
      return advance("promote_href", { ...draft, subtitle: subtitle.data }, m.askHref);
    }

    const result = await createOrder(app.core, {
      tgUserId: userId,
      productId: draft.productId,
      ...(step === "promote_target"
        ? { targetUsername: text }
        : { banner: { title: draft.title, subtitle: draft.subtitle, href: text } }),
    });
    if (!result.ok) {
      if (result.error === "no_slots" || result.error === "product_unavailable") {
        await deleteBotDraft(app.db, userId);
        await ctx.reply(
          result.error === "no_slots" ? m.noSlots(result.nextFreeAt) : m.productUnavailable,
        );
        return;
      }
      // Content problems keep the draft: the buyer just sends it again.
      await again(
        result.error === "target_not_listed"
          ? m.targetNotListed(parseTelegramRef(text) ?? text)
          : result.error === "invalid_target"
            ? m.invalidTarget
            : m.invalidHref,
      );
      return;
    }
    await deleteBotDraft(app.db, userId);
    const product = await getProduct(app.db, result.order.productId);
    if (!product) return;
    const methods = await paymentMethods(app);
    const summary = m.order({
      id: result.order.id,
      product: productName(locale, product),
      stars: product.priceStars,
      usdt: product.priceUsdt,
      ...orderTarget(result.order),
    });
    if (!(methods.stars || methods.usdt)) {
      await ctx.reply(`${summary}\n\n${m.noPaymentMethod}`);
      return;
    }
    const keyboard = new InlineKeyboard();
    if (methods.stars) keyboard.text(m.payStars(product.priceStars), `ps:${result.order.id}`).row();
    if (methods.usdt) keyboard.text(m.payUsdt(product.priceUsdt), `pu:${result.order.id}`);
    await ctx.reply(`${summary}\n\n${m.choosePayment}`, { reply_markup: keyboard });
  });

  /** The caller's own pending order with its product, or null after telling them it's gone. */
  async function pendingOrder(ctx: Context & { from: { id: number } }, orderId: number) {
    const order = await getOrder(app.db, orderId);
    const product = order ? await getProduct(app.db, order.productId) : undefined;
    if (order?.tgUserId !== ctx.from.id || order.status !== "pending" || !product) {
      await ctx.answerCallbackQuery({
        text: (await app.m(ctx)).promote.orderExpired,
        show_alert: true,
      });
      return null;
    }
    return { order, product };
  }

  composer.callbackQuery(/^ps:(\d+)$/, async (ctx) => {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const found = await pendingOrder(ctx, Number(ctx.match[1]));
    if (!found) return;
    const { order, product } = found;
    if (!(await app.settings()).payments.starsEnabled) {
      await ctx.answerCallbackQuery({ text: m.noPaymentMethod, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const name = productName(locale, product).slice(0, 32);
    await ctx.api.sendInvoice(
      ctx.chat.id,
      name,
      m.invoiceDescription(orderTarget(order), order.days).slice(0, 255),
      `order:${order.id}`,
      "XTR",
      [{ label: name, amount: product.priceStars }],
      { provider_token: "" },
    );
  });

  composer.callbackQuery(/^pu:(\d+)$/, async (ctx) => {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const found = await pendingOrder(ctx, Number(ctx.match[1]));
    if (!found) return;
    const { order, product } = found;
    const { payments } = await app.settings();
    const token = payments.cryptoPayEnabled
      ? await getCredential(app.core, "cryptopay_token").catch((error: unknown) => {
          console.error("crypto pay token unavailable", error);
          return null;
        })
      : null;
    if (!token) {
      await ctx.answerCallbackQuery({ text: m.noPaymentMethod, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      const invoice = await createCryptoPayInvoice(app.core, {
        token,
        network: payments.cryptoPayNetwork,
        amount: product.priceUsdt,
        description: m.invoiceDescription(orderTarget(order), order.days),
        payload: `order:${order.id}`,
        expiresIn: 3600,
      });
      await setOrderInvoice(app.db, order.id, invoice.invoiceId);
      await ctx.reply(m.usdtInvoice(product.priceUsdt), {
        reply_markup: new InlineKeyboard().url(m.payNow, invoice.payUrl),
      });
    } catch (error) {
      console.error("crypto pay invoice failed", error);
      await ctx.reply(m.invoiceFailed);
    }
  });

  return root;
}
