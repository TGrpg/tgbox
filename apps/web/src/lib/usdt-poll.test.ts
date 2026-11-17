import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  nextUsdtPoll,
  startUsdtPolling,
  USDT_CHECK_TIMEOUT_MS,
  USDT_GRACE_MS,
  USDT_POLL_MS,
} from "./usdt-poll.ts";

const MINUTE = 60_000;
const expiresAt = 1_000_000_000;

describe("nextUsdtPoll", () => {
  test("keeps checking for a 2-hour quote well past the first 15 minutes", () => {
    expect(nextUsdtPoll(expiresAt - 100 * MINUTE, expiresAt)).toBe(USDT_POLL_MS);
  });

  test("keeps checking through the grace period, for a transfer sent at the last minute", () => {
    expect(nextUsdtPoll(expiresAt + MINUTE, expiresAt)).toBe(USDT_POLL_MS);
    expect(nextUsdtPoll(expiresAt + USDT_GRACE_MS - 1_000, expiresAt)).toBe(1_000);
  });

  test("stops once the grace period is over", () => {
    expect(nextUsdtPoll(expiresAt + USDT_GRACE_MS, expiresAt)).toBeNull();
  });

  test("never asks more often than the backend can confirm", () => {
    expect(USDT_POLL_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("startUsdtPolling", () => {
  const start = (check: (signal: AbortSignal) => Promise<boolean>, visible = () => true) => {
    const events = { paid: 0, stopped: 0 };
    const polling = startUsdtPolling({
      expiresAt: Date.now() + 30 * MINUTE,
      check,
      visible,
      onPaid: () => events.paid++,
      onStop: () => events.stopped++,
    });
    return { polling, events };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a check that never answers is given up and the next one goes out", async () => {
    const signals: AbortSignal[] = [];
    const { polling } = start(
      (signal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    expect(signals).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(USDT_CHECK_TIMEOUT_MS);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    expect(signals).toHaveLength(2);
    polling.stop();
  });

  test("hiding and showing the screen while a check is out doesn't start a second one", async () => {
    let calls = 0;
    let answer: (paid: boolean) => void = () => {};
    const { polling } = start(() => {
      calls++;
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    for (let i = 0; i < 3; i++) polling.wake();
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS - 1);
    expect(calls).toBe(1);
    answer(false);
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    expect(calls).toBe(2);
    polling.stop();
  });

  test("the grace deadline stops polling even with a check hanging, so the manual check shows", async () => {
    const { polling, events } = start(() => new Promise<boolean>(() => {}));
    await vi.advanceTimersByTimeAsync(30 * MINUTE + USDT_GRACE_MS);
    expect(events.stopped).toBe(1);
    polling.stop();
  });

  test("a hidden screen doesn't poll, and is paid once a check says so", async () => {
    let visible = false;
    const check = vi.fn(async () => true);
    const { polling, events } = start(check, () => visible);
    await vi.advanceTimersByTimeAsync(2 * USDT_POLL_MS);
    expect(check).not.toHaveBeenCalled();
    visible = true;
    polling.wake();
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    expect(events).toEqual({ paid: 1, stopped: 0 });
    await vi.advanceTimersByTimeAsync(30 * MINUTE + USDT_GRACE_MS);
    expect(check).toHaveBeenCalledOnce();
    expect(events.stopped).toBe(0);
  });

  test("stopping aborts a check in flight and nothing fires afterwards", async () => {
    const signals: AbortSignal[] = [];
    const { polling, events } = start((signal) => {
      signals.push(signal);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve(true)));
    });
    await vi.advanceTimersByTimeAsync(USDT_POLL_MS);
    polling.stop();
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * MINUTE + USDT_GRACE_MS);
    expect(events).toEqual({ paid: 0, stopped: 0 });
  });
});
