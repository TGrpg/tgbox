import type { AppOrder, AppSubmission } from "@tgbox/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The four numbers at the top of the Mini App's "Mine" screen, from the lists it already has. */
export function meCounts(me: { submissions: AppSubmission[]; orders: AppOrder[] }) {
  const submissions = (status: AppSubmission["status"]) =>
    me.submissions.filter((item) => item.status === status).length;
  const orders = (status: AppOrder["status"]) =>
    me.orders.filter((item) => item.status === status).length;
  return {
    listed: submissions("approved"),
    reviewing: submissions("pending"),
    running: orders("active"),
    unpaid: orders("pending"),
  };
}

/**
 * Whole days a running promotion has left, rounded up so the last day still reads "1 day". Zero
 * once the end has passed: the hourly expiry job just hasn't caught up with it yet.
 */
export const daysLeft = (endsAt: number, now: number) =>
  Math.max(0, Math.ceil((endsAt - now) / DAY_MS));

/** How long a cached `/api/app/me` is used as is; an older copy is shown while it is fetched again. */
export const ME_FRESH_MS = 60 * 1000;

/**
 * What a screen does with the cached `/me`: "fresh" uses it, "stale" shows it while fetching again,
 * "none" ignores it — nothing cached, or it belongs to another Telegram account on this device.
 */
export function meCacheUse(
  cached: { userId: number | null; at: number } | null,
  userId: number | null,
  now: number,
): "fresh" | "stale" | "none" {
  if (cached === null || cached.userId !== userId) return "none";
  return now - cached.at < ME_FRESH_MS ? "fresh" : "stale";
}
