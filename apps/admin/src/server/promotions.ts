import { type Actor, approveBannerOrder, type CoreContext, rejectOrder } from "@tgbox/core";
import { listOrders, listProducts } from "@tgbox/db";
import { OrderStatus, ProductKind } from "@tgbox/shared";
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

/** Approves a paid banner order; `not_awaiting_review` when someone else handled it first. */
export async function approveOrder(core: CoreContext, input: { orderId: number; actor: Actor }) {
  const order = await approveBannerOrder(core, input);
  return order ? { ok: true as const } : { ok: false as const, error: "not_awaiting_review" };
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

const username = z.string().trim().min(1).max(100);

export const ManualPromotionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pin"), days: z.number().int().min(1).max(365), username }),
  z.object({
    kind: z.literal("banner"),
    days: z.number().int().min(1).max(365),
    banner: z.object({
      title: z.string().max(100),
      subtitle: z.string().max(100),
      href: z.string().max(300),
    }),
  }),
]);

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
  slots: z.number().int(),
  active: z.boolean(),
  sort: z.number().int(),
});
