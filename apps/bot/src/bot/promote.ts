import {
  checkSlots,
  createCryptoPayInvoice,
  createOrder,
  getCredential,
  hasCredential,
  quoteUsdtOrder,
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
  setOrderBanner,
  setOrderInvoice,
} from "@tgbox/db";
import {
  BannerContent,
  isEntryProduct,
  type Locale,
  ProductKind,
  parseTelegramRef,
} from "@tgbox/shared";
import { Composer, type Context, InlineKeyboard } from "grammy";
import type { Message, PhotoSize } from "grammy/types";
import type { App } from "./app.ts";
import { messages } from "./i18n/index.ts";

const promoteSteps = [
  "promote_target",
  "promote_title",
  "promote_subtitle",
  "promote_href",
  "promote_image",
] as const;
type PromoteStep = (typeof promoteSteps)[number];

type PromoteDraft = { productId: number; title?: string; subtitle?: string; href?: string };

/** Only drafts written by this flow; submission drafts are left to `submit`. */
function parsePromoteDraft(step: string, payload: unknown) {
  const promoteStep = promoteSteps.find((s) => s === step);
  if (!promoteStep || typeof payload !== "object" || payload === null) return null;
  const p: Record<string, unknown> = { ...payload };
  if (typeof p.productId !== "number") return null;
  const draft: PromoteDraft = { productId: p.productId };
  if (typeof p.title === "string") draft.title = p.title;
  if (typeof p.subtitle === "string") draft.subtitle = p.subtitle;
  if (typeof p.href === "string") draft.href = p.href;
  return { step: promoteStep, draft };
}

/** Telegram re-encodes photos as JPEG; documents keep whatever the buyer sent. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Preferred photo size: big enough for a card, small enough to download inside the webhook. */
const PHOTO_TARGET_BYTES = 200 * 1024;
/** Hard ceiling, checked on the declared size and again on the downloaded bytes. */
const IMAGE_MAX_BYTES = 1024 * 1024;

/** The largest size still under the target, else the smallest Telegram offers. */
function pickPhoto(sizes: PhotoSize[]) {
  const bySize = [...sizes].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
  return bySize.filter((size) => (size.file_size ?? 0) <= PHOTO_TARGET_BYTES).at(-1) ?? bySize[0];
}

/** The image a buyer sent for the banner, or null when the message isn't a usable one. */
function bannerImageOf(message: Message): { fileId: string; contentType: string } | null {
  if (message.photo?.length) {
    const photo = pickPhoto(message.photo);
    if (!photo || (photo.file_size ?? 0) > IMAGE_MAX_BYTES) return null;
    return { fileId: photo.file_id, contentType: "image/jpeg" };
  }
  const document = message.document;
  const contentType = document?.mime_type ?? "";
  if (!document || !IMAGE_TYPES.has(contentType)) return null;
  if ((document.file_size ?? 0) > IMAGE_MAX_BYTES) return null;
  return { fileId: document.file_id, contentType };
}

export const productName = (locale: Locale, product: Product) =>
  locale === "en" ? product.nameEn : product.nameZh;

export const orderTarget = (order: Pick<Order, "kind" | "targetUsername" | "banner">) => ({
  kind: order.kind,
  username: order.targetUsername,
  bannerTitle: order.banner?.title ?? null,
});

/**
 * The single source of truth for which payment buttons exist. Each method needs its own switch to
 * be on *and* to actually be usable: Crypto Pay needs a token that can be decrypted, self-hosted
 * USDT needs a receiving address. Every callback re-checks its own method before acting, so a
 * stale button can't route a payment to a method the operator has since turned off.
 */
async function paymentMethods(app: App) {
  const { payments } = await app.settings();
  const cryptoPay =
    payments.cryptoPayEnabled &&
    Boolean(app.env.SETTINGS_KEY) &&
    (await hasCredential(app.core, "cryptopay_token"));
  return {
    stars: payments.starsEnabled,
    cryptoPay,
    usdtSelf: payments.usdtSelfEnabled && payments.usdtAddress !== "",
  };
}

export function promote(app: App) {
  const root = new Composer<Context>();
  const composer = root.chatType("private");
  const cancelKeyboard = (locale: Locale) =>
    new InlineKeyboard().text(messages(locale).cancel, "px");

  /** Step one: the placements on sale. Prices come with the second step, one placement at a time. */
  async function showProducts(ctx: Context) {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const [products, methods] = await Promise.all([
      listProducts(app.db, { activeOnly: true }),
      paymentMethods(app),
    ]);
    if (products.length === 0 || !(methods.stars || methods.cryptoPay || methods.usdtSelf)) {
      await ctx.reply(m.unavailable);
      return;
    }
    const keyboard = new InlineKeyboard();
    const kinds = ProductKind.options.filter((kind) => products.some((p) => p.kind === kind));
    for (const kind of kinds) keyboard.text(m.placement(kind), `pk:${kind}`).row();
    await ctx.reply(m.intro(`${app.env.SITE_URL}${locale === "en" ? "/en" : ""}/advertise/`), {
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  }

  /** Step two: one placement's durations with the prices the buyer can actually pay. */
  composer.callbackQuery(/^pk:([a-z_]+)$/, async (ctx) => {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    await ctx.answerCallbackQuery();
    const kind = ProductKind.safeParse(ctx.match[1]);
    const [products, methods] = await Promise.all([
      listProducts(app.db, { activeOnly: true }),
      paymentMethods(app),
    ]);
    const offered = kind.success ? products.filter((product) => product.kind === kind.data) : [];
    if (!kind.success || offered.length === 0) {
      await ctx.reply(m.productUnavailable);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const product of offered) {
      // Only quote a price the buyer can actually pay: an operator who turned Stars off should
      // not have Stars prices advertised anywhere in the flow.
      const label = m.product({
        name: productName(locale, product),
        days: product.days,
        stars: methods.stars ? product.priceStars : null,
        usdt: methods.usdtSelf || methods.cryptoPay ? product.priceUsdt : null,
      });
      keyboard.text(label, `pp:${product.id}`).row();
    }
    keyboard.text(m.back, "promote");
    await ctx
      .editMessageText(m.chooseDuration(kind.data), { reply_markup: keyboard })
      .catch(() => ctx.reply(m.chooseDuration(kind.data), { reply_markup: keyboard }));
  });

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
    // Checked up front so nobody fills in an ad only to hear the slots are gone. A category pin's
    // slots depend on the entry, so it is checked again once the buyer names one.
    const slots = await checkSlots(app.core, product.kind);
    if (slots.available === 0) {
      await ctx.reply(m.noSlots(slots.nextFreeAt));
      return;
    }
    const forEntry = isEntryProduct(product.kind);
    const step: PromoteStep = forEntry ? "promote_target" : "promote_title";
    const draft: PromoteDraft = { productId: product.id };
    await putBotDraft(app.db, {
      tgUserId: ctx.from.id,
      step,
      payload: draft,
      updatedAt: app.now(),
    });
    await ctx.reply(forEntry ? m.askTarget : m.askTitle, {
      reply_markup: cancelKeyboard(locale),
    });
  });

  composer.callbackQuery("px", async (ctx) => {
    await deleteBotDraft(app.db, ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText((await app.m(ctx)).promote.cancelled).catch(() => {});
  });

  /**
   * Downloads the buyer's image and stores it under the order id. Returns the public URL, or null
   * when anything failed — a banner without an image is still a valid banner.
   */
  async function storeBannerImage(
    ctx: Context,
    orderId: number,
    image: { fileId: string; contentType: string },
  ) {
    try {
      const { file_path } = await ctx.api.getFile(image.fileId);
      if (!file_path) return null;
      const res = await app.fetch(
        `https://api.telegram.org/file/bot${app.env.BOT_TOKEN}/${file_path}`,
      );
      if (!res.ok) return null;
      const body = await res.arrayBuffer();
      // Telegram's declared size can be absent; the downloaded bytes are the real check.
      if (body.byteLength === 0 || body.byteLength > IMAGE_MAX_BYTES) return null;
      // Browsers load this key straight from R2, so it must be cacheable; a day only, because the
      // key has no version in it and the buyer can replace the image of an existing order.
      await app.env.MEDIA.put(`promos/${orderId}.jpg`, body, {
        httpMetadata: { contentType: image.contentType, cacheControl: "public, max-age=86400" },
      });
      return `${app.env.R2_PUBLIC_URL}/promos/${orderId}.jpg`;
    } catch (error) {
      console.error("banner image upload failed", orderId, error);
      return null;
    }
  }

  // Every step of the purchase, including the optional image, reads the draft once. A photo or a
  // command that isn't part of this flow falls through to the submission and support composers.
  composer.on("message", async (ctx, next) => {
    const text = ctx.message.text?.trim();
    if (text?.startsWith("/") && !/^\/skip(@\w+)?$/.test(text)) return next();
    const userId = ctx.from.id;
    const row = await getBotDraft(app.db, userId, app.now());
    const current = row ? parsePromoteDraft(row.step, row.payload) : null;
    if (!current) return next();

    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
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

    /** Title, subtitle and link were validated as they came in; the image (banner only) is optional. */
    const createAd = async (image: { fileId: string; contentType: string } | null) => {
      await deleteBotDraft(app.db, userId);
      const created = await createOrder(app.core, {
        tgUserId: userId,
        productId: draft.productId,
        banner: { title: draft.title, subtitle: draft.subtitle, href: draft.href },
      });
      if (!created.ok) {
        await ctx.reply(
          created.error === "no_slots"
            ? m.noSlots(created.nextFreeAt)
            : created.error === "product_unavailable"
              ? m.productUnavailable
              : m.invalidHref,
        );
        return;
      }
      // The order exists before the upload: the R2 key is the order id.
      let banner = created.order.banner;
      if (image && banner) {
        const imageUrl = await storeBannerImage(ctx, created.order.id, image);
        if (imageUrl) {
          banner = { ...banner, imageUrl };
          await setOrderBanner(app.db, created.order.id, banner);
        } else {
          await ctx.reply(m.imageFailed);
        }
      }
      await offerPayment(ctx, locale, { ...created.order, banner });
    };

    if (step === "promote_image") {
      const skipped = text !== undefined && /^\/skip(@\w+)?$/.test(text);
      const image = skipped ? null : bannerImageOf(ctx.message);
      if (!skipped && !image) {
        await again(m.invalidImage);
        return;
      }
      await createAd(image);
      return;
    }

    // Every remaining step reads text; a photo sent to one of them is not ours.
    if (text === undefined) return next();

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
    if (step === "promote_href") {
      const href = BannerContent.shape.href.safeParse(text);
      if (!href.success) {
        await again(m.invalidHref);
        return;
      }
      draft.href = href.data;
      // Only the home banner carries an image; the announcement bar is text.
      const product = await getProduct(app.db, draft.productId);
      if (product?.kind === "banner") return advance("promote_image", draft, m.askImage);
      await createAd(null);
      return;
    }

    // promote_target: the promoted entry, the only step that creates the order from text alone.
    const result = await createOrder(app.core, {
      tgUserId: userId,
      productId: draft.productId,
      targetUsername: text,
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
          : m.invalidTarget,
      );
      return;
    }
    await deleteBotDraft(app.db, userId);
    await offerPayment(ctx, locale, result.order);
  });

  /** The order summary plus the payment buttons the settings allow. */
  async function offerPayment(ctx: Context, locale: Locale, order: Order) {
    const m = messages(locale).promote;
    const product = await getProduct(app.db, order.productId);
    if (!product) return;
    const methods = await paymentMethods(app);
    const summary = m.order({
      id: order.id,
      product: productName(locale, product),
      stars: methods.stars ? product.priceStars : null,
      usdt: methods.usdtSelf || methods.cryptoPay ? product.priceUsdt : null,
      ...orderTarget(order),
    });
    if (!(methods.stars || methods.cryptoPay || methods.usdtSelf)) {
      await ctx.reply(`${summary}\n\n${m.noPaymentMethod}`);
      return;
    }
    const keyboard = new InlineKeyboard();
    if (methods.stars) keyboard.text(m.payStars(product.priceStars), `ps:${order.id}`).row();
    if (methods.usdtSelf) keyboard.text(m.payUsdtSelf(product.priceUsdt), `pv:${order.id}`).row();
    if (methods.cryptoPay) keyboard.text(m.payUsdt(product.priceUsdt), `pu:${order.id}`);
    await ctx.reply(`${summary}\n\n${m.choosePayment}`, { reply_markup: keyboard });
  }

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

  // Self-hosted USDT: the buyer transfers an amount unique to their order and the cron settles it.
  composer.callbackQuery(/^pv:(\d+)$/, async (ctx) => {
    const locale = await app.locale(ctx);
    const m = messages(locale).promote;
    const found = await pendingOrder(ctx, Number(ctx.match[1]));
    if (!found) return;
    const { order } = found;
    const quote = await quoteUsdtOrder(app.core, {
      orderId: order.id,
      productId: order.productId,
    });
    if (!quote.ok) {
      // "no_amount" is transient (every tail for this price is reserved); the rest mean the
      // operator turned the method off between the button being drawn and this tap.
      const text = quote.error === "no_amount" ? m.usdtNoAmount : m.noPaymentMethod;
      await ctx.answerCallbackQuery({ text, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(
      m.usdtTransfer({
        address: quote.quote.address,
        amount: quote.quote.amount,
        minutes: Math.round((quote.quote.expiresAt - app.now()) / 60_000),
      }),
      { parse_mode: "HTML" },
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
