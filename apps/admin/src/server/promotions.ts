import {
  type Actor,
  type CoreContext,
  refundOrder,
  rejectOrder,
  startPaidOrder,
} from "@tgbox/core";
import { listOrders, listProducts } from "@tgbox/db";
import { entryProductKinds, OrderStatus, ProductKind } from "@tgbox/shared";
import { z } from "zod";
import { clicksByOrder } from "./clicks.ts";

export const OrdersInput = z.object({
  status: OrderStatus.optional(),
  page: z.number().int().min(1),
});

/**
 * One page of orders with product names and, for orders whose promotion is still running, what it
 * delivered. Provider ids (invoice/charge) stay on the server.
 */
export async function loadOrders(
  core: CoreContext,
  input: z.infer<typeof OrdersInput> & { pageSize: number },
) {
  const [{ rows, total }, products] = await Promise.all([
    listOrders(core.db, { status: input.status, page: input.page, pageSize: input.pageSize }),
    listProducts(core.db),
  ]);
  const names = new Map(products.map((product) => [product.id, product.nameZh]));
  const clicks = await clicksByOrder(
    core,
    rows.map((order) => order.id),
  );
  return {
    rows: rows.map(({ invoiceId: _invoice, chargeId: _charge, ...order }) => ({
      ...order,
      productName: names.get(order.productId) ?? null,
      /** null once the promotion has ended and its row is gone. */
      clicks: clicks[order.id] ?? null,
    })),
    total,
  };
}

export const OrderReviewInput = z.object({ orderId: z.number().int().positive() });
export const RejectOrderInput = OrderReviewInput.extend({
  reason: z.string().trim().max(200),
});

/**
 * Starts a paid order: approves a brand ad, or starts a pin paid while its placement was full.
 * `not_awaiting_review` when someone else handled it first, `no_slots` while the placement is full.
 */
export async function approveOrder(core: CoreContext, input: { orderId: number; actor: Actor }) {
  const result = await startPaidOrder(core, input);
  if (result.ok) return { ok: true as const };
  return {
    ok: false as const,
    error: result.error === "no_slots" ? ("no_slots" as const) : ("not_awaiting_review" as const),
  };
}

/** Rejects a paid order; Stars payments are refunded by core, other providers by hand. */
export async function rejectPaidOrder(
  core: CoreContext,
  input: { orderId: number; reason: string; actor: Actor },
) {
  const result = await rejectOrder(core, {
    orderId: input.orderId,
    actor: input.actor,
    reason: input.reason || null,
  });
  if (!result) return { ok: false as const, error: "not_awaiting_review" };
  return { ok: true as const, refunded: result.refunded, provider: result.order.provider };
}

export const RefundOrderInput = OrderReviewInput.extend({ manual: z.boolean() });

/**
 * Retries the Stars refund of a rejected order, or (`manual`) records that an admin refunded it by
 * hand. `not_refundable` when it isn't a rejected, unrefunded order (or a manual one sent as Stars).
 */
export async function refundRejectedOrder(
  core: CoreContext,
  input: { orderId: number; manual: boolean; actor: Actor },
) {
  const result = await refundOrder(core, input);
  if (!result) return { ok: false as const, error: "not_refundable" };
  return { ok: true as const, refunded: result.refunded };
}

const username = z.string().trim().min(1).max(100);

export const ManualPromotionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(entryProductKinds),
    days: z.number().int().min(1).max(365),
    username,
  }),
  z.object({
    kind: z.enum(["banner", "announcement"]),
    days: z.number().int().min(1).max(365),
    banner: z.object({
      title: z.string().max(100),
      subtitle: z.string().max(100),
      href: z.string().max(300),
    }),
  }),
]);

export const PlacementSlotsInput = z.object({ kind: ProductKind, slots: z.number().int() });

export const PromotionIdInput = z.object({ promotionId: z.number().int().positive() });
export const ExtendPromotionInput = PromotionIdInput.extend({
  days: z.number().int().min(1).max(365),
});

export const ProductInput = z.object({
  id: z.number().int().positive().optional(),
  kind: ProductKind,
  nameZh: z.string().max(100),
  nameEn: z.string().max(100),
  days: z.number().int(),
  priceStars: z.number().int(),
  priceUsdt: z.string().trim().max(20),
  active: z.boolean(),
  sort: z.number().int(),
});
