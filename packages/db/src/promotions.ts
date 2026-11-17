import type { BannerContent, OrderStatus, ProductKind } from "@tgbox/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  min,
  type SQL,
  sql,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { batchWrite, type Db } from "./access.ts";
import { entries, orders, products, promotions, usdtPayments } from "./schema.ts";

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;

/**
 * Which slots a count covers: every promotion of a kind, or — for category pins, whose slots are
 * per category — only those whose entry is in `categoryId`.
 */
export type SlotScope = { kind: ProductKind; categoryId?: number };

/** Promotions and orders store the entry's username as it was listed, so this is exact. */
const entryInCategory = (username: SQL | SQLiteColumn, categoryId: number | undefined) =>
  categoryId === undefined
    ? undefined
    : sql`${username} IN (SELECT ${entries.username} FROM ${entries} WHERE ${entries.categoryId} = ${categoryId})`;

/* ---------------------------------------------------------------- products */

export function listProducts(db: Db, { activeOnly = false }: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(products)
    .where(activeOnly ? eq(products.active, true) : undefined)
    .orderBy(asc(products.sort), asc(products.id));
}

export async function getProduct(db: Db, id: number) {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

/** Inserts when `id` is omitted, else updates that product. Returns the id, or null if missing. */
export async function upsertProductRow(db: Db, product: typeof products.$inferInsert) {
  if (product.id === undefined) {
    const [row] = await db.insert(products).values(product).returning({ id: products.id });
    return row?.id ?? null;
  }
  const { id, ...fields } = product;
  const result = await db.update(products).set(fields).where(eq(products.id, id)).run();
  return result.meta.changes > 0 ? id : null;
}

/** One placement's size: every product of the kind carries it, so its durations never disagree. */
export async function setProductSlots(db: Db, kind: ProductKind, slots: number) {
  const result = await db.update(products).set({ slots }).where(eq(products.kind, kind)).run();
  return result.meta.changes;
}

/* ------------------------------------------------------------------ orders */

export type NewOrder = Pick<
  typeof orders.$inferInsert,
  "tgUserId" | "productId" | "kind" | "days" | "targetUsername" | "banner" | "createdAt"
>;

export async function createPendingOrder(db: Db, order: NewOrder) {
  const [row] = await db
    .insert(orders)
    .values({ ...order, status: "pending" })
    .returning();
  if (!row) throw new Error("createPendingOrder: no row returned");
  return row;
}

/**
 * A buyer's unpaid orders, newest first, with the state of any USDT quote. Served by the
 * `orders_user` index. `limit` bounds the read; a buyer is never allowed more than that many.
 */
export function listPendingOrdersOf(db: Db, tgUserId: number, limit: number) {
  return db
    .select({
      order: orders,
      usdtStatus: usdtPayments.status,
      usdtExpiresAt: usdtPayments.expiresAt,
    })
    .from(orders)
    .leftJoin(usdtPayments, eq(usdtPayments.orderId, orders.id))
    .where(and(eq(orders.tgUserId, tgUserId), eq(orders.status, "pending")))
    .orderBy(desc(orders.id))
    .limit(limit);
}

export async function getOrder(db: Db, id: number) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

/** Newest first. Scans `orders` (primary key only); admin traffic only. */
export async function listOrders(
  db: Db,
  query: { status?: OrderStatus; page: number; pageSize?: number },
) {
  const where = query.status === undefined ? undefined : eq(orders.status, query.status);
  const size = Math.max(1, Math.min(Math.trunc(query.pageSize ?? 20) || 1, 100));
  const offset = (Math.max(1, Math.trunc(query.page) || 1) - 1) * size;
  const [rows, totals] = await db.batch([
    db.select().from(orders).where(where).orderBy(desc(orders.id)).limit(size).offset(offset),
    db.select({ count: count() }).from(orders).where(where),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}

/** Records the provider invoice of a still-pending order. Returns true if updated. */
/**
 * Rewrites a pending order's banner. Used to attach the uploaded image, whose R2 key needs the
 * order id and therefore can only be known once the order exists.
 */
export async function setOrderBanner(db: Db, id: number, banner: BannerContent) {
  const result = await db
    .update(orders)
    .set({ banner })
    .where(and(eq(orders.id, id), eq(orders.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

export async function setOrderInvoice(db: Db, id: number, invoiceId: string) {
  const result = await db
    .update(orders)
    .set({ invoiceId })
    .where(and(eq(orders.id, id), eq(orders.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

/**
 * pending → paid. Payment callbacks retry, so a second call changes nothing and returns false.
 */
export async function markOrderPaidRow(
  db: Db,
  input: Required<Pick<Order, "provider" | "chargeId" | "amount" | "currency" | "paidAt">> & {
    id: number;
  },
) {
  const { id, ...fields } = input;
  const result = await db
    .update(orders)
    .set({ ...fields, status: "paid" })
    .where(and(eq(orders.id, id), eq(orders.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

/**
 * paid → active and the promotion it starts, in one batch (a D1 batch is a transaction), so an
 * order is never active with nothing to show. The promotion is copied from the order row and only
 * written when this batch made it active. Returns the new promotion's id, or null if the order
 * was not `paid` or its placement has no free slot.
 *
 * The slot check is part of the UPDATE, so two payments racing for the last slot can't both start:
 * live promotions of the kind (in the entry's category, for category pins) must be fewer than the
 * placement's size. Raw SQL because the correlated subqueries must name `orders` explicitly.
 */
export async function activateOrderRow(
  db: Db,
  input: { id: number; startsAt: number; endsAt: number },
) {
  const [, inserted] = await batchWrite(db, [
    sql`UPDATE orders SET status = 'active', starts_at = ${input.startsAt}, ends_at = ${input.endsAt}
      WHERE id = ${input.id} AND status = 'paid'
        AND (
          SELECT COUNT(*) FROM promotions AS live
          WHERE live.kind = orders.kind AND live.ends_at > ${input.startsAt}
            AND (orders.kind <> 'category_pin' OR live.entry_username IN (
              SELECT username FROM entries WHERE category_id = (
                SELECT category_id FROM entries WHERE username = orders.target_username
              )
            ))
        ) < (SELECT COALESCE(MAX(slots), 0) FROM products WHERE kind = orders.kind)`,
    // `starts_at` is this call's own timestamp; the NOT EXISTS keeps a concurrent activation in the
    // same millisecond (whose update changed nothing) from adding a second row.
    sql`INSERT INTO promotions (kind, order_id, entry_username, banner, starts_at, ends_at, created_at)
      SELECT kind, id, target_username, banner, starts_at, ends_at, ${input.startsAt} FROM orders
      WHERE id = ${input.id} AND status = 'active' AND starts_at = ${input.startsAt}
        AND NOT EXISTS (
          SELECT 1 FROM promotions WHERE order_id = ${input.id} AND starts_at = ${input.startsAt}
        )
      RETURNING id`,
  ]);
  const [row] = (inserted?.results ?? []) as { id: number }[];
  return row?.id ?? null;
}

/** State-machine update guarded by the expected current status. Returns true if it applied. */
export async function setOrderStatus(
  db: Db,
  input: {
    id: number;
    from: OrderStatus;
    to: OrderStatus;
    fields?: Partial<Pick<Order, "startsAt" | "endsAt" | "note" | "remindedAt">>;
  },
) {
  const result = await db
    .update(orders)
    .set({ ...input.fields, status: input.to })
    .where(and(eq(orders.id, input.id), eq(orders.status, input.from)))
    .run();
  return result.meta.changes > 0;
}

/** Paid orders not live yet (awaiting review, or a full slot) hold a slot of their kind. */
export async function countPaidOrders(db: Db, scope: SlotScope) {
  const [row] = await db
    .select({ value: count() })
    .from(orders)
    .where(
      and(
        eq(orders.kind, scope.kind),
        eq(orders.status, "paid"),
        entryInCategory(orders.targetUsername, scope.categoryId),
      ),
    );
  return row?.value ?? 0;
}

/** Active orders ending in (now, until] that were not reminded yet, soonest first. */
export function listOrdersToRemind(db: Db, now: number, until: number, limit = 100) {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "active"),
        gt(orders.endsAt, now),
        lte(orders.endsAt, until),
        isNull(orders.remindedAt),
      ),
    )
    .orderBy(asc(orders.endsAt))
    .limit(limit);
}

/** Marks reminders as sent, in one statement. Returns how many were marked. */
export async function markOrdersReminded(db: Db, ids: number[], now: number) {
  if (ids.length === 0) return 0;
  const result = await db
    .update(orders)
    .set({ remindedAt: now })
    .where(and(inArray(orders.id, ids), isNull(orders.remindedAt)))
    .run();
  return result.meta.changes;
}

/** Returns true the first time only. */
export async function markOrderReminded(db: Db, id: number, now: number) {
  const result = await db
    .update(orders)
    .set({ remindedAt: now })
    .where(and(eq(orders.id, id), isNull(orders.remindedAt)))
    .run();
  return result.meta.changes > 0;
}

/** Deletes unpaid orders created before `cutoff`. Returns how many were deleted. */
export async function deleteStalePendingOrders(db: Db, cutoff: number) {
  const result = await db
    .delete(orders)
    .where(and(eq(orders.status, "pending"), lt(orders.createdAt, cutoff)))
    .run();
  return result.meta.changes;
}

/* -------------------------------------------------------------- promotions */

export type NewPromotion = Omit<typeof promotions.$inferInsert, "id">;

export async function insertPromotion(db: Db, promotion: NewPromotion) {
  const [row] = await db.insert(promotions).values(promotion).returning();
  if (!row) throw new Error("insertPromotion: no row returned");
  return row;
}

export async function getPromotion(db: Db, id: number) {
  const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
  return row;
}

/** Live promotions (ends_at > now), earliest start first. */
export function listActivePromotions(db: Db, now: number, kind?: ProductKind) {
  return db
    .select()
    .from(promotions)
    .where(
      and(gt(promotions.endsAt, now), kind === undefined ? undefined : eq(promotions.kind, kind)),
    )
    .orderBy(asc(promotions.startsAt), asc(promotions.id));
}

export async function countActivePromotions(db: Db, scope: SlotScope, now: number) {
  const [row] = await db
    .select({ value: count() })
    .from(promotions)
    .where(
      and(
        eq(promotions.kind, scope.kind),
        gt(promotions.endsAt, now),
        entryInCategory(promotions.entryUsername, scope.categoryId),
      ),
    );
  return row?.value ?? 0;
}

/** When the next slot in `scope` frees up; null when none of them is taken. */
export async function earliestPromotionEnd(db: Db, scope: SlotScope, now: number) {
  const [row] = await db
    .select({ value: min(promotions.endsAt) })
    .from(promotions)
    .where(
      and(
        eq(promotions.kind, scope.kind),
        gt(promotions.endsAt, now),
        entryInCategory(promotions.entryUsername, scope.categoryId),
      ),
    );
  return row?.value ?? null;
}

/** Promotions whose end has passed (ends_at <= now), the longest-ended first. */
export function listExpiredPromotions(db: Db, now: number, limit = 100) {
  return db
    .select()
    .from(promotions)
    .where(lte(promotions.endsAt, now))
    .orderBy(asc(promotions.endsAt), asc(promotions.id))
    .limit(limit);
}

/**
 * Removes promotions and moves their orders from active to expired in one transaction.
 * Returns the deleted promotions and the orders that changed (for user notifications).
 */
export async function endPromotionRows(db: Db, ids: number[]) {
  if (ids.length === 0) return { promotions: [], orders: [] };
  const [endedOrders, deleted] = await db.batch([
    db
      .update(orders)
      .set({ status: "expired" })
      .where(
        and(
          eq(orders.status, "active"),
          inArray(
            orders.id,
            db
              .select({ id: promotions.orderId })
              .from(promotions)
              .where(inArray(promotions.id, ids)),
          ),
        ),
      )
      .returning(),
    db.delete(promotions).where(inArray(promotions.id, ids)).returning(),
  ]);
  return { promotions: deleted, orders: endedOrders };
}

/** Moves ends_at by `ms` (may be negative). Returns true if the promotion exists. */
export async function extendPromotionRow(db: Db, id: number, ms: number) {
  const result = await db
    .update(promotions)
    .set({ endsAt: sql`${promotions.endsAt} + ${ms}` })
    .where(eq(promotions.id, id))
    .run();
  return result.meta.changes > 0;
}
