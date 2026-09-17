import {
  type CoreContext,
  type PromotionClicks,
  promotionClickHistory,
  promotionClickTotals,
} from "@tgbox/core";
import { listActivePromotions } from "@tgbox/db";
import { z } from "zod";

const noClicks: PromotionClicks = { total: 0, recent: 0 };

/** Live promotions plus what each one delivered: lifetime clicks and the last 7 days. */
export async function loadActivePromotions(core: CoreContext) {
  const now = core.now();
  const rows = await listActivePromotions(core.db, now);
  const clicks = await promotionClickTotals(
    core,
    rows.map((row) => row.id),
  );
  return {
    now,
    rows: rows.map((row) => ({ ...row, clicks: clicks[row.id] ?? noClicks })),
  };
}

export const ClickHistoryInput = z.object({
  promotionId: z.number().int().positive(),
  days: z.number().int().min(1).max(90).optional(),
});

export function loadClickHistory(core: CoreContext, input: z.infer<typeof ClickHistoryInput>) {
  return promotionClickHistory(core, input);
}

/**
 * Click totals keyed by order id, for the orders one page of the admin is showing. Promotions are
 * deleted when they expire, so an order whose promotion is over has no entry: the tab then shows a
 * dash rather than a zero it would have to explain.
 */
export async function clicksByOrder(core: CoreContext, orderIds: number[]) {
  if (orderIds.length === 0) return {};
  const wanted = new Set(orderIds);
  // `promotions` has no index on `order_id`, and only a handful are ever live: scan and filter.
  const live = await listActivePromotions(core.db, core.now());
  const promotions = live.filter(
    (promotion) => promotion.orderId !== null && wanted.has(promotion.orderId),
  );
  const clicks = await promotionClickTotals(
    core,
    promotions.map((promotion) => promotion.id),
  );
  const byOrder: Record<number, PromotionClicks> = {};
  for (const promotion of promotions) {
    if (promotion.orderId !== null) byOrder[promotion.orderId] = clicks[promotion.id] ?? noClicks;
  }
  return byOrder;
}
