import {
  countActivePromotions,
  countPaidOrders,
  createPendingOrder,
  deleteStalePendingOrders,
  earliestPromotionEnd,
  endPromotionRows,
  extendPromotionRow,
  getEntryByUsername,
  getOrder,
  getProduct,
  getPromotion,
  insertPromotion,
  listExpiredPromotions,
  listOrdersToRemind,
  listProducts,
  markOrderPaidRow,
  markOrderReminded,
  type Order,
  type Promotion,
  setOrderStatus,
  setProductSlots,
  upsertProductRow,
} from "@tgbox/db";
import {
  BannerContent,
  isEntryProduct,
  type PaymentCurrency,
  type PaymentProvider,
  type ProductKind,
  parseTelegramRef,
} from "@tgbox/shared";
import { audit } from "./audit.ts";
import { markDirtyAndDispatch } from "./build.ts";
import { type Actor, type CoreContext, tgActor } from "./context.ts";
import { refundStars } from "./payments/stars.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 365;
/** Unpaid orders older than this are deleted. */
const PENDING_TTL_MS = 2 * DAY_MS;
/** Renewal reminder window before a promotion ends. */
const REMIND_BEFORE_MS = DAY_MS;

const orderTarget = (id: number) => `order:${id}`;
const promotionTarget = (id: number) => `promotion:${id}`;

/** Why promotion content was refused: entry promotions need an approved entry, ads valid content. */
export type PromotionContentError = "invalid_target" | "target_not_listed" | "invalid_banner";

/**
 * Validates what a promotion shows: an approved entry for entry promotions, ad content for brand
 * ads. The announcement bar is text only, so an image sent along with it is dropped.
 */
async function promotionContent(
  ctx: CoreContext,
  kind: ProductKind,
  input: { targetUsername?: string | null; banner?: unknown },
): Promise<
  | { ok: true; targetUsername: string | null; categoryId?: number; banner: BannerContent | null }
  | { ok: false; error: PromotionContentError }
> {
  if (!isEntryProduct(kind)) {
    const banner = BannerContent.safeParse(input.banner);
    if (!banner.success) return { ok: false, error: "invalid_banner" };
    const { imageUrl, ...text } = banner.data;
    return {
      ok: true,
      targetUsername: null,
      banner: kind === "announcement" ? text : { ...text, imageUrl },
    };
  }
  const username = input.targetUsername ? parseTelegramRef(input.targetUsername) : null;
  if (!username) return { ok: false, error: "invalid_target" };
  const entry = await getEntryByUsername(ctx.db, username);
  if (entry?.status !== "approved") return { ok: false, error: "target_not_listed" };
  return {
    ok: true,
    targetUsername: entry.username,
    categoryId: entry.categoryId,
    banner: null,
  };
}

/**
 * Free slots: the largest `slots` among the kind's products, minus live promotions and paid orders
 * not live yet. Category pins count within `categoryId` (their slots are per category); without it
 * the answer is for a category with nothing pinned. `nextFreeAt` is the earliest end of a live one.
 */
export async function checkSlots(ctx: CoreContext, kind: ProductKind, categoryId?: number) {
  const now = ctx.now();
  const scope = { kind, categoryId: kind === "category_pin" ? categoryId : undefined };
  const [products, active, paid, nextFreeAt] = await Promise.all([
    listProducts(ctx.db),
    countActivePromotions(ctx.db, scope, now),
    countPaidOrders(ctx.db, scope),
    earliestPromotionEnd(ctx.db, scope, now),
  ]);
  const slots = Math.max(0, ...products.filter((p) => p.kind === kind).map((p) => p.slots));
  if (kind === "category_pin" && categoryId === undefined)
    return { available: slots, nextFreeAt: null };
  return { available: Math.max(0, slots - active - paid), nextFreeAt };
}

/** Free slots for an existing order: a category pin counts within its entry's category. */
export async function checkOrderSlots(
  ctx: CoreContext,
  order: Pick<Order, "kind" | "targetUsername">,
) {
  const entry =
    order.kind === "category_pin" && order.targetUsername
      ? await getEntryByUsername(ctx.db, order.targetUsername)
      : undefined;
  return checkSlots(ctx, order.kind, entry?.categoryId);
}

/** A buyer starts a purchase in the bot. Payment is attached later by `markOrderPaid`. */
export async function createOrder(
  ctx: CoreContext,
  input: {
    tgUserId: number;
    productId: number;
    /** entry promotions: @username or t.me link of an approved entry */
    targetUsername?: string | null;
    /** brand ads: validated as BannerContent */
    banner?: unknown;
  },
): Promise<
  | { ok: true; order: Order }
  | { ok: false; error: PromotionContentError | "product_unavailable" }
  | { ok: false; error: "no_slots"; nextFreeAt: number | null }
> {
  const product = await getProduct(ctx.db, input.productId);
  if (!product?.active) return { ok: false, error: "product_unavailable" };
  const content = await promotionContent(ctx, product.kind, input);
  if (!content.ok) return content;
  const slots = await checkSlots(ctx, product.kind, content.categoryId);
  if (slots.available === 0) return { ok: false, error: "no_slots", nextFreeAt: slots.nextFreeAt };

  const order = await createPendingOrder(ctx.db, {
    tgUserId: input.tgUserId,
    productId: product.id,
    kind: product.kind,
    days: product.days,
    targetUsername: content.targetUsername,
    banner: content.banner,
    createdAt: ctx.now(),
  });
  await audit(ctx, tgActor(input.tgUserId), "order.create", orderTarget(order.id), {
    productId: product.id,
  });
  return { ok: true, order };
}

/** paid → active: starts the promotion now for the order's days and rebuilds the site. */
async function activateOrder(ctx: CoreContext, order: Order, actor: Actor) {
  const now = ctx.now();
  const endsAt = now + order.days * DAY_MS;
  const applied = await setOrderStatus(ctx.db, {
    id: order.id,
    from: "paid",
    to: "active",
    fields: { startsAt: now, endsAt },
  });
  if (!applied) return false;
  const promotion = await insertPromotion(ctx.db, {
    kind: order.kind,
    orderId: order.id,
    entryUsername: order.targetUsername,
    banner: order.banner,
    startsAt: now,
    endsAt,
    createdAt: now,
  });
  await audit(ctx, actor, "promotion.start", promotionTarget(promotion.id), {
    orderId: order.id,
    kind: order.kind,
    endsAt,
  });
  await markDirtyAndDispatch(ctx);
  return true;
}

/**
 * Records a payment (idempotent: retried callbacks return `changed: false`). Entry promotions go
 * live immediately; brand ads stay `paid` until reviewed. Returns null for an unknown order.
 */
export async function markOrderPaid(
  ctx: CoreContext,
  input: {
    orderId: number;
    provider: PaymentProvider;
    chargeId: string;
    amount: string;
    currency: PaymentCurrency;
    /** Defaults to the buyer; set for payments recorded by an admin. */
    actor?: Actor;
  },
) {
  const order = await getOrder(ctx.db, input.orderId);
  if (!order) return null;
  const changed = await markOrderPaidRow(ctx.db, {
    id: order.id,
    provider: input.provider,
    chargeId: input.chargeId,
    amount: input.amount,
    currency: input.currency,
    paidAt: ctx.now(),
  });
  if (changed) {
    const actor = input.actor ?? tgActor(order.tgUserId);
    await audit(ctx, actor, "order.paid", orderTarget(order.id), {
      provider: input.provider,
      amount: input.amount,
      currency: input.currency,
    });
    if (isEntryProduct(order.kind)) await activateOrder(ctx, order, actor);
  }
  return { order: (await getOrder(ctx.db, order.id)) ?? order, changed };
}

/** Admin approves a paid brand ad. Returns the updated order, or null if it was not awaiting review. */
export async function approveAdOrder(ctx: CoreContext, input: { orderId: number; actor: Actor }) {
  const order = await getOrder(ctx.db, input.orderId);
  if (!order || isEntryProduct(order.kind) || order.status !== "paid") return null;
  if (!(await activateOrder(ctx, order, input.actor))) return null;
  return (await getOrder(ctx.db, order.id)) ?? null;
}

/**
 * Admin rejects a paid order. Stars payments are refunded automatically when BOT_TOKEN is set;
 * other providers are refunded by hand (`refunded: false`). Null if the order was not paid.
 */
export async function rejectOrder(
  ctx: CoreContext,
  input: { orderId: number; actor: Actor; reason?: string | null },
) {
  const order = await getOrder(ctx.db, input.orderId);
  if (!order) return null;
  const rejected = await setOrderStatus(ctx.db, {
    id: order.id,
    from: "paid",
    to: "rejected",
    fields: { note: input.reason ?? null },
  });
  if (!rejected) return null;
  await audit(ctx, input.actor, "order.reject", orderTarget(order.id), {
    reason: input.reason ?? null,
  });

  let refunded = false;
  if (order.provider === "stars" && order.chargeId && ctx.config.BOT_TOKEN) {
    const ok = await refundStars(ctx, { userId: order.tgUserId, chargeId: order.chargeId }).catch(
      (error: unknown) => {
        console.error("stars refund failed", error);
        return false;
      },
    );
    if (ok) {
      refunded = await setOrderStatus(ctx.db, { id: order.id, from: "rejected", to: "refunded" });
      if (refunded) {
        await audit(ctx, input.actor, "order.refund", orderTarget(order.id), {
          provider: order.provider,
          amount: order.amount,
        });
      }
    }
  }
  return { order: (await getOrder(ctx.db, order.id)) ?? order, refunded };
}

const validDays = (days: number) => Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

/** Free promotion created by an admin; it has no order and starts now. */
export async function createManualPromotion(
  ctx: CoreContext,
  input: {
    kind: ProductKind;
    days: number;
    targetUsername?: string | null;
    banner?: unknown;
    actor: Actor;
  },
): Promise<
  { ok: true; promotion: Promotion } | { ok: false; error: PromotionContentError | "invalid_days" }
> {
  if (!validDays(input.days)) return { ok: false, error: "invalid_days" };
  const content = await promotionContent(ctx, input.kind, input);
  if (!content.ok) return content;
  const now = ctx.now();
  const promotion = await insertPromotion(ctx.db, {
    kind: input.kind,
    orderId: null,
    entryUsername: content.targetUsername,
    banner: content.banner,
    startsAt: now,
    endsAt: now + input.days * DAY_MS,
    createdAt: now,
  });
  await audit(ctx, input.actor, "promotion.start", promotionTarget(promotion.id), {
    kind: input.kind,
    days: input.days,
    manual: true,
  });
  await markDirtyAndDispatch(ctx);
  return { ok: true, promotion };
}

/** Ends a promotion early; its order (if any) becomes expired. Returns false if it doesn't exist. */
export async function endPromotion(ctx: CoreContext, input: { promotionId: number; actor: Actor }) {
  const ended = await endPromotionRows(ctx.db, [input.promotionId]);
  if (ended.promotions.length === 0) return false;
  await audit(ctx, input.actor, "promotion.end", promotionTarget(input.promotionId), {
    orderIds: ended.orders.map((order) => order.id),
  });
  await markDirtyAndDispatch(ctx);
  return true;
}

/**
 * Pushes a live promotion's end back by `days` (the site shows no end dates, so no rebuild).
 * The order's end moves too and its renewal reminder is re-armed.
 */
export async function extendPromotion(
  ctx: CoreContext,
  input: { promotionId: number; days: number; actor: Actor },
) {
  if (!validDays(input.days)) return null;
  if (!(await extendPromotionRow(ctx.db, input.promotionId, input.days * DAY_MS))) return null;
  const promotion = await getPromotion(ctx.db, input.promotionId);
  if (!promotion) return null;
  if (promotion.orderId !== null) {
    await setOrderStatus(ctx.db, {
      id: promotion.orderId,
      from: "active",
      to: "active",
      fields: { endsAt: promotion.endsAt, remindedAt: null },
    });
  }
  await audit(ctx, input.actor, "promotion.extend", promotionTarget(promotion.id), {
    days: input.days,
    endsAt: promotion.endsAt,
  });
  return promotion;
}

/** How many of a placement run at once (per category for category pins). */
export const MAX_SLOTS = 100;

/**
 * Sets a placement's size, the one number the admin tunes instead of it being built in. It applies
 * to every duration of the kind, and the site is rebuilt because it shows the free slots.
 */
export async function setPlacementSlots(
  ctx: CoreContext,
  input: { kind: ProductKind; slots: number; actor: Actor },
) {
  if (!Number.isInteger(input.slots) || input.slots < 1 || input.slots > MAX_SLOTS) return false;
  if ((await setProductSlots(ctx.db, input.kind, input.slots)) === 0) return false;
  await audit(ctx, input.actor, "product.slots", `placement:${input.kind}`, { slots: input.slots });
  await markDirtyAndDispatch(ctx);
  return true;
}

/**
 * Creates a product when `id` is omitted, else edits it. Prices are not retroactive. A product
 * takes its placement's size (see `setPlacementSlots`); a placement's first product starts at 1.
 */
export async function upsertProduct(
  ctx: CoreContext,
  input: {
    id?: number;
    kind: ProductKind;
    nameZh: string;
    nameEn: string;
    days: number;
    priceStars: number;
    /** Decimal string with up to 2 fraction digits */
    priceUsdt: string;
    active: boolean;
    sort: number;
    actor: Actor;
  },
): Promise<{ ok: true; id: number } | { ok: false; error: "invalid" | "not_found" }> {
  const { actor, ...product } = input;
  const slots = Math.max(
    1,
    ...(await listProducts(ctx.db)).filter((p) => p.kind === input.kind).map((p) => p.slots),
  );
  const fields = {
    ...product,
    slots,
    nameZh: product.nameZh.trim(),
    nameEn: product.nameEn.trim(),
  };
  const valid =
    fields.nameZh.length > 0 &&
    fields.nameZh.length <= 40 &&
    fields.nameEn.length > 0 &&
    fields.nameEn.length <= 60 &&
    validDays(fields.days) &&
    Number.isInteger(fields.priceStars) &&
    fields.priceStars >= 1 &&
    fields.priceStars <= 1_000_000 &&
    /^\d{1,6}(\.\d{1,2})?$/.test(fields.priceUsdt) &&
    Number(fields.priceUsdt) > 0 &&
    Number.isInteger(fields.sort);
  if (!valid) return { ok: false, error: "invalid" };
  const id = await upsertProductRow(ctx.db, fields);
  if (id === null) return { ok: false, error: "not_found" };
  await audit(ctx, actor, "product.upsert", `product:${id}`, fields);
  return { ok: true, id };
}

/**
 * Hourly job: ends expired promotions, picks orders due a renewal reminder (marked reminded here,
 * so each is returned once), and deletes stale unpaid orders. The caller sends the messages.
 */
export async function runPromotionMaintenance(ctx: CoreContext, now: number) {
  const expiredIds = (await listExpiredPromotions(ctx.db, now)).map((row) => row.id);
  const ended = await endPromotionRows(ctx.db, expiredIds);
  if (ended.promotions.length > 0) {
    await audit(ctx, "system", "promotion.expire", "promotions", {
      promotionIds: ended.promotions.map((row) => row.id),
      orderIds: ended.orders.map((row) => row.id),
    });
    await markDirtyAndDispatch(ctx);
  }

  const expiringSoon: Order[] = [];
  for (const order of await listOrdersToRemind(ctx.db, now, now + REMIND_BEFORE_MS)) {
    if (await markOrderReminded(ctx.db, order.id, now)) expiringSoon.push(order);
  }

  const deletedPending = await deleteStalePendingOrders(ctx.db, now - PENDING_TTL_MS);
  if (deletedPending > 0) {
    await audit(ctx, "system", "order.cleanup", "orders", { deleted: deletedPending });
  }
  return { expired: ended.orders, expiringSoon, deletedPending };
}
