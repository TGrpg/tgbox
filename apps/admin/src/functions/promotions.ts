import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createManualPromotion, endPromotion, extendPromotion, upsertProduct } from "@tgbox/core";
import {
  countActivePromotions,
  countPaidOrders,
  listActivePromotions,
  listProducts,
} from "@tgbox/db";
import type { OrderStatus } from "@tgbox/shared";
import { queryKeys } from "@/lib/query-keys.ts";
import { adminMiddleware } from "@/server/middleware.ts";
import {
  approveOrder,
  ExtendPromotionInput,
  loadOrders,
  ManualPromotionInput,
  OrderReviewInput,
  OrdersInput,
  ProductInput,
  PromotionIdInput,
  RejectOrderInput,
  rejectPaidOrder,
} from "@/server/promotions.ts";

/* ------------------------------------------------------------------ orders */

export const ORDERS_PAGE_SIZE = 20;

const $listOrders = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .inputValidator(OrdersInput)
  .handler(({ data, context }) =>
    loadOrders(context.core, { ...data, pageSize: ORDERS_PAGE_SIZE }),
  );

export const ordersQueryOptions = (status: OrderStatus | undefined, page: number) =>
  queryOptions({
    queryKey: [...queryKeys.orders, status ?? "all", page],
    queryFn: ({ signal }) => $listOrders({ data: { status, page }, signal }),
    placeholderData: keepPreviousData,
  });

export type OrderRow = Awaited<ReturnType<typeof loadOrders>>["rows"][number];

export const $approveOrder = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(OrderReviewInput)
  .handler(({ data, context }) =>
    approveOrder(context.core, { orderId: data.orderId, actor: context.auth.actor }),
  );

export const $rejectOrder = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(RejectOrderInput)
  .handler(({ data, context }) =>
    rejectPaidOrder(context.core, { ...data, actor: context.auth.actor }),
  );

/* -------------------------------------------------------------- promotions */

const $listActivePromotions = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const now = context.core.now();
    return { now, rows: await listActivePromotions(context.core.db, now) };
  });

export const activePromotionsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.promotions,
    queryFn: ({ signal }) => $listActivePromotions({ signal }),
  });

export type PromotionRow = Awaited<ReturnType<typeof $listActivePromotions>>["rows"][number];

export const $endPromotion = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(PromotionIdInput)
  .handler(({ data, context }) =>
    endPromotion(context.core, { promotionId: data.promotionId, actor: context.auth.actor }),
  );

export const $extendPromotion = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(ExtendPromotionInput)
  .handler(async ({ data, context }) => {
    const promotion = await extendPromotion(context.core, { ...data, actor: context.auth.actor });
    return promotion ? { ok: true as const, endsAt: promotion.endsAt } : { ok: false as const };
  });

export const $createManualPromotion = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(ManualPromotionInput)
  .handler(async ({ data, context }) => {
    const result = await createManualPromotion(context.core, {
      kind: data.kind,
      days: data.days,
      targetUsername: data.kind === "pin" ? data.username : null,
      banner: data.kind === "banner" ? data.banner : undefined,
      actor: context.auth.actor,
    });
    return result.ok ? { ok: true as const, id: result.promotion.id } : result;
  });

/** Dashboard counters: banners waiting for review and live promotions. */
const $getPromotionCounts = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const { db } = context.core;
    const now = context.core.now();
    const [pendingBanners, pins, banners] = await Promise.all([
      countPaidOrders(db, "banner"),
      countActivePromotions(db, "pin", now),
      countActivePromotions(db, "banner", now),
    ]);
    return { pendingBanners, active: pins + banners };
  });

export const promotionCountsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.promotionCounts,
    queryFn: ({ signal }) => $getPromotionCounts({ signal }),
    staleTime: 30_000,
  });

/* ---------------------------------------------------------------- products */

const $listProducts = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(({ context }) => listProducts(context.core.db));

export const productsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.products,
    queryFn: ({ signal }) => $listProducts({ signal }),
  });

export type ProductRow = Awaited<ReturnType<typeof $listProducts>>[number];

export const $upsertProduct = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .inputValidator(ProductInput)
  .handler(({ data, context }) =>
    upsertProduct(context.core, { ...data, actor: context.auth.actor }),
  );
