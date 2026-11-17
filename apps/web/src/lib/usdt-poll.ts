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

/** A status check still unanswered after this is given up, so it can't hold the next one back. */
export const USDT_CHECK_TIMEOUT_MS = 15_000;

/**
 * Runs `check` with a signal that aborts after `USDT_CHECK_TIMEOUT_MS` or when `cancel` aborts.
 * Hand-rolled rather than `AbortSignal.any`, which older Telegram webviews lack.
 */
export async function withCheckTimeout<T>(
  check: (signal: AbortSignal) => Promise<T>,
  cancel?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, USDT_CHECK_TIMEOUT_MS);
  cancel?.addEventListener("abort", abort);
  try {
    return await check(controller.signal);
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener("abort", abort);
  }
}

/**
 * Polls one open USDT payment: a check every `USDT_POLL_MS` while `visible()`, never two at once,
 * until it is paid or the grace period is over. `onStop` fires at that deadline on its own timer,
 * so a request that hangs can't keep the buyer from the manual check. `wake` is for visibility
 * changes; `stop` for unmounting, which also aborts a check in flight.
 */
export function startUsdtPolling(input: {
  expiresAt: number;
  /** Whether the order is paid now. */
  check: (signal: AbortSignal) => Promise<boolean>;
  visible: () => boolean;
  onPaid: () => void;
  onStop: () => void;
}) {
  const cancel = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let over = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (over || inFlight || !input.visible()) return;
    const delay = nextUsdtPoll(Date.now(), input.expiresAt);
    if (delay !== null) timer = setTimeout(() => void tick(), delay);
  };
  const tick = async () => {
    timer = undefined;
    inFlight = true;
    const paid = await withCheckTimeout(input.check, cancel.signal).catch(() => false);
    inFlight = false;
    if (cancel.signal.aborted) return;
    // A check that lands just after the deadline still counts.
    if (paid) {
      over = true;
      clearTimeout(deadline);
      input.onPaid();
      return;
    }
    schedule();
  };
  const finish = () => {
    over = true;
    clearTimeout(timer);
    input.onStop();
  };
  const deadline = setTimeout(finish, Math.max(0, input.expiresAt + USDT_GRACE_MS - Date.now()));

  schedule();
  return {
    wake: schedule,
    stop: () => {
      over = true;
      cancel.abort();
      clearTimeout(timer);
      clearTimeout(deadline);
    },
  };
}
