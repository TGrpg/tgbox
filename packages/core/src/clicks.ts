import { clickDay, clicksByPromotion, clicksForPromotion, dayBefore } from "@tgbox/db";
import type { CoreContext } from "./context.ts";

/** Days counted as "recent" in the promotion list. */
export const RECENT_DAYS = 7;
/** Days shown in the per-promotion detail view. */
export const HISTORY_DAYS = 14;

export type PromotionClicks = { total: number; recent: number };

/**
 * Click totals for a set of promotions: lifetime, plus the last {@link RECENT_DAYS} UTC days.
 * Promotions nobody clicked are reported as zeroes rather than left out, so the admin table has a
 * number in every row.
 */
export async function promotionClickTotals(ctx: CoreContext, promotionIds: number[]) {
  const since = dayBefore(clickDay(ctx.now()), RECENT_DAYS - 1);
  const rows = await clicksByPromotion(ctx.db, promotionIds, since);
  const counted = new Map(rows.map((row) => [row.promotionId, row]));
  const clicks: Record<number, PromotionClicks> = {};
  for (const id of promotionIds) {
    const row = counted.get(id);
    clicks[id] = { total: row?.total ?? 0, recent: row?.recent ?? 0 };
  }
  return clicks;
}

/**
 * Daily clicks of one promotion over the last `days` UTC days, oldest first and zero-filled, so
 * the bar list has a bar for every day instead of a ragged series.
 */
export async function promotionClickHistory(
  ctx: CoreContext,
  input: { promotionId: number; days?: number },
) {
  const days = input.days ?? HISTORY_DAYS;
  const today = clickDay(ctx.now());
  const since = dayBefore(today, days - 1);
  const rows = await clicksForPromotion(ctx.db, input.promotionId, since);
  const counted = new Map(rows.map((row) => [row.day, row.clicks]));
  return Array.from({ length: days }, (_, index) => {
    const day = dayBefore(today, days - 1 - index);
    return { day, clicks: counted.get(day) ?? 0 };
  });
}
