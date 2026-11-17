import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { batchWrite, type Db } from "./access.ts";
import { auditLog, usdtPayments } from "./schema.ts";

export type UsdtPayment = typeof usdtPayments.$inferSelect;

/**
 * Records the amount an order is waiting for. The order id is the primary key, so a buyer who taps
 * "pay with USDT" twice keeps the amount they were already quoted instead of being handed a second
 * one — otherwise a transfer for the first amount would arrive with nothing left to match it.
 * Pending amounts are unique too: when another order took this amount first, nothing is written
 * and, for an order without a quote yet, the result is undefined so the caller picks another.
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
      address: usdtPayments.address,
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

/**
 * Releases the amounts of orders nobody paid in time, so they can be handed out again. Only for
 * `addresses` whose transfers were read in full: a window the watcher didn't see to the end may
 * still hold the payment.
 */
export async function expireUsdtPayments(db: Db, now: number, addresses: string[]) {
  if (addresses.length === 0) return 0;
  const result = await db
    .update(usdtPayments)
    .set({ status: "expired" })
    .where(
      and(
        eq(usdtPayments.status, "pending"),
        lt(usdtPayments.expiresAt, now),
        inArray(usdtPayments.address, addresses),
      ),
    )
    .run();
  return result.meta.changes;
}

/**
 * Of these transaction ids, the ones already accounted for: a transfer that paid an order, or one
 * already recorded as unmatched. One read either way. The `action` is a literal so SQLite can use
 * the partial index `audit_usdt_unmatched` (migration 0023) instead of scanning the audit log.
 */
export async function knownUsdtTransfers(db: Db, txHashes: string[]) {
  if (txHashes.length === 0) return new Set<string>();
  const targets = txHashes.map((hash) => `tx:${hash}`);
  const [paid, recorded] = await db.batch([
    db
      .select({ hash: usdtPayments.txHash })
      .from(usdtPayments)
      .where(inArray(usdtPayments.txHash, txHashes)),
    db
      .select({ target: auditLog.target })
      .from(auditLog)
      .where(and(sql`${auditLog.action} = 'usdt.unmatched'`, inArray(auditLog.target, targets))),
  ]);
  return new Set([
    ...paid.flatMap((row) => (row.hash ? [row.hash] : [])),
    ...recorded.flatMap((row) => (row.target ? [row.target.slice(3)] : [])),
  ]);
}

/** Records transfers that matched no order, one audit row each, in one round trip. */
export async function recordUnmatchedUsdtTransfers(
  db: Db,
  transfers: { txHash: string; amount: string; address: string }[],
  now: number,
) {
  if (transfers.length === 0) return;
  await batchWrite(
    db,
    transfers.map(
      (transfer) => sql`INSERT INTO audit_log (actor, action, target, payload, created_at)
        VALUES ('system', 'usdt.unmatched', ${`tx:${transfer.txHash}`},
          ${JSON.stringify({ amount: transfer.amount, address: transfer.address })}, ${now})`,
    ),
  );
}
