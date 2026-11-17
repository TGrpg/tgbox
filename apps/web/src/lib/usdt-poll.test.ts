import { describe, expect, test } from "vitest";
import { nextUsdtPoll, USDT_GRACE_MS, USDT_POLL_MS } from "./usdt-poll.ts";

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
