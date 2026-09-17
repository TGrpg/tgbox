import { and, asc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import type { Db } from "./access.ts";
import { promotionClicks } from "./schema.ts";

/**
 * Click counters for paid promotions. This is the one counter that lives in D1 rather than in
 * Analytics Engine: the number is billed to an advertiser, so it has to survive, be queryable per
 * promotion and per day, and stay readable from the admin. The cost is bounded — one row per
 * promotion per day, written by the redirect route with `clicks = clicks + 1`.
 */

/** The UTC calendar day a timestamp belongs to (`YYYY-MM-DD`), the key of `promotion_clicks`. */
export const clickDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `days` whole days before `day`, as another `YYYY-MM-DD` key. */
export const dayBefore = (day: string, days: number) =>
  clickDay(Date.parse(`${day}T00:00:00Z`) - days * 24 * 60 * 60 * 1000);

/**
 * Counts one click. Exactly one row written: the table has no index beyond its primary key, and
 * the upsert touches a single (promotion, day) row whether or not it existed.
 */
export async function recordClick(db: Db, input: { promotionId: number; day: string }) {
  const result = await db
    .insert(promotionClicks)
    .values({ promotionId: input.promotionId, day: input.day, clicks: 1 })
    .onConflictDoUpdate({
      target: [promotionClicks.promotionId, promotionClicks.day],
      set: { clicks: sql`${promotionClicks.clicks} + 1` },
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Lifetime total and the total since `sinceDay` (inclusive) for each promotion, in one query.
 * Promotions without a single click are absent from the result.
 */
export async function clicksByPromotion(db: Db, promotionIds: number[], sinceDay: string) {
  if (promotionIds.length === 0) return [];
  const rows = await db
    .select({
      promotionId: promotionClicks.promotionId,
      total: sum(promotionClicks.clicks),
      recent: sum(
        sql`CASE WHEN ${promotionClicks.day} >= ${sinceDay} THEN ${promotionClicks.clicks} ELSE 0 END`,
      ),
    })
    .from(promotionClicks)
    .where(inArray(promotionClicks.promotionId, promotionIds))
    .groupBy(promotionClicks.promotionId);
  return rows.map((row) => ({
    promotionId: row.promotionId,
    total: Number(row.total ?? 0),
    recent: Number(row.recent ?? 0),
  }));
}

/** Daily counts of one promotion since `sinceDay` (inclusive), oldest first. Days with no click are absent. */
export function clicksForPromotion(db: Db, promotionId: number, sinceDay: string) {
  return db
    .select({ day: promotionClicks.day, clicks: promotionClicks.clicks })
    .from(promotionClicks)
    .where(and(eq(promotionClicks.promotionId, promotionId), gte(promotionClicks.day, sinceDay)))
    .orderBy(asc(promotionClicks.day));
}
