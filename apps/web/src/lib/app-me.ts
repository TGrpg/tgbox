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
