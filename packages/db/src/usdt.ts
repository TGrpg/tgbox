import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { usdtPayments } from "./schema.ts";

export type UsdtPayment = typeof usdtPayments.$inferSelect;

/**
 * Records the amount an order is waiting for. The order id is the primary key, so a buyer who taps
 * "pay with USDT" twice keeps the amount they were already quoted instead of being handed a second
 * one — otherwise a transfer for the first amount would arrive with nothing left to match it.
 */
export async function createUsdtPayment(
  db: Db,
  row: typeof usdtPayments.$inferInsert & { orderId: number },
): Promise<UsdtPayment | undefined> {
  await db.insert(usdtPayments).values(row).onConflictDoNothing().run();
  const [stored] = await db
    .select()
    .from(usdtPayments)
    .where(eq(usdtPayments.orderId, row.orderId));
  return stored;
}

export async function getUsdtPayment(db: Db, orderId: number) {
  const [row] = await db.select().from(usdtPayments).where(eq(usdtPayments.orderId, orderId));
  return row;
}

/**
 * Every unpaid amount currently spoken for, including the ones whose window has closed but that
 * the cleanup hasn't reached yet — reusing such an amount would let a late transfer pay the wrong
 * order. Bounded by how many orders can be unpaid at once, which the slot limits already cap.
 */
export function listPendingUsdtPayments(db: Db) {
  return db
    .select({
      orderId: usdtPayments.orderId,
      amountMicro: usdtPayments.amountMicro,
      createdAt: usdtPayments.createdAt,
      expiresAt: usdtPayments.expiresAt,
    })
    .from(usdtPayments)
    .where(eq(usdtPayments.status, "pending"));
}

/**
 * Marks the transfer that paid this order. Conditional on the row still being pending, so a
 * replayed transfer changes nothing and the caller can tell by the returned flag.
 */
export async function markUsdtPaid(
  db: Db,
  input: { orderId: number; txHash: string; now: number },
) {
  const result = await db
    .update(usdtPayments)
    .set({ status: "paid", txHash: input.txHash, paidAt: input.now })
    .where(and(eq(usdtPayments.orderId, input.orderId), eq(usdtPayments.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

/** Releases the amounts of orders nobody paid in time, so they can be handed out again. */
export async function expireUsdtPayments(db: Db, now: number) {
  const result = await db
    .update(usdtPayments)
    .set({ status: "expired" })
    .where(and(eq(usdtPayments.status, "pending"), lt(usdtPayments.expiresAt, now)))
    .run();
  return result.meta.changes;
}

/** Cheap guard for the cron: skip the chain call entirely when nobody owes us anything. */
export async function countPendingUsdtPayments(db: Db, now: number) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usdtPayments)
    .where(and(eq(usdtPayments.status, "pending"), sql`${usdtPayments.expiresAt} >= ${now}`));
  return row?.count ?? 0;
}
