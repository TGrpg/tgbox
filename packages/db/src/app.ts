import { and, count, desc, eq, gte, inArray, sum } from "drizzle-orm";
import type { Db } from "./access.ts";
import {
  orders,
  products,
  promotionClicks,
  promotions,
  settings,
  submissions,
  userPrefs,
} from "./schema.ts";

/** Newest-first cap; the Mini App shows a history, not an archive. */
const PAGE = 50;

/**
 * Everything `/api/app/me` shows, in one `db.batch` — a single D1 round trip for the one request a
 * Mini App session is allowed to cost. `submissions` and `orders` are read through the
 * `(tg_user_id, id)` indexes added in migration 0011; without them this is two full scans.
 */
export async function loadAppOverview(db: Db, input: { tgUserId: number; since: number }) {
  const own = db.select({ id: orders.id }).from(orders).where(eq(orders.tgUserId, input.tgUserId));
  const [ownSubmissions, ownOrders, clicks, settingsRows, submittedToday, prefs, productRows] =
    await db.batch([
      db
        .select({
          id: submissions.id,
          username: submissions.username,
          kind: submissions.kind,
          status: submissions.status,
          rejectReason: submissions.rejectReason,
          createdAt: submissions.createdAt,
          reviewedAt: submissions.reviewedAt,
        })
        .from(submissions)
        .where(eq(submissions.tgUserId, input.tgUserId))
        .orderBy(desc(submissions.id))
        .limit(PAGE),
      db
        .select({
          id: orders.id,
          productId: orders.productId,
          kind: orders.kind,
          status: orders.status,
          amount: orders.amount,
          currency: orders.currency,
          createdAt: orders.createdAt,
          startsAt: orders.startsAt,
          endsAt: orders.endsAt,
          targetUsername: orders.targetUsername,
        })
        .from(orders)
        .where(eq(orders.tgUserId, input.tgUserId))
        .orderBy(desc(orders.id))
        .limit(PAGE),
      // Clicks of the promotions those orders bought. `promotions` holds only live rows (expired
      // ones are deleted), so a finished campaign reports 0 — a scan of a few dozen rows either
      // way, which is why `promotions.order_id` is deliberately not indexed.
      db
        .select({ orderId: promotions.orderId, clicks: sum(promotionClicks.clicks) })
        .from(promotionClicks)
        .innerJoin(promotions, eq(promotions.id, promotionClicks.promotionId))
        .where(inArray(promotions.orderId, own))
        .groupBy(promotions.orderId),
      db.select({ key: settings.key, value: settings.value }).from(settings),
      db
        .select({ value: count() })
        .from(submissions)
        .where(
          and(eq(submissions.tgUserId, input.tgUserId), gte(submissions.createdAt, input.since)),
        ),
      db
        .select({ locale: userPrefs.locale })
        .from(userPrefs)
        .where(eq(userPrefs.tgUserId, input.tgUserId)),
      db
        .select({ id: products.id, nameZh: products.nameZh, nameEn: products.nameEn })
        .from(products),
    ]);

  return {
    submissions: ownSubmissions,
    orders: ownOrders,
    clicksByOrder: new Map(
      clicks.flatMap((row) =>
        row.orderId === null ? [] : [[row.orderId, Number(row.clicks ?? 0)] as const],
      ),
    ),
    settingsRows,
    submittedToday: submittedToday[0]?.value ?? 0,
    locale: prefs[0]?.locale ?? null,
    productNames: new Map(productRows.map((row) => [row.id, row])),
  };
}
