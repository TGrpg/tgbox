/**
 * When the USDT pay screen asks whether its order is paid. The bot matches transfers on a 5-minute
 * cron, so asking every few seconds only spends Worker requests; 30s still shows the result within
 * one cron run of it landing.
 */
export const USDT_POLL_MS = 30_000;

/** A transfer sent just before the quote expires is confirmed by the next cron run or two. */
export const USDT_GRACE_MS = 10 * 60 * 1000;

/** Milliseconds until the next check, or null once the quote is past its grace period. */
export function nextUsdtPoll(now: number, expiresAt: number): number | null {
  const stopAt = expiresAt + USDT_GRACE_MS;
  if (now >= stopAt) return null;
  return Math.min(USDT_POLL_MS, stopAt - now);
}
