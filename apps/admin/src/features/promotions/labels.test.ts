import { expect, test } from "vitest";
import { formatAmount, remainingDays } from "./labels.ts";

const HOUR = 60 * 60 * 1000;

test.each([
  [2 * HOUR, 1],
  [24 * HOUR, 1],
  [25 * HOUR, 2],
  [-HOUR, 0],
])("remainingDays with %i ms left → %i", (left, days) => {
  expect(remainingDays(1_000_000 + left, 1_000_000)).toBe(days);
});

test.each([
  ["500", "XTR", "500 ⭐"],
  ["10.5", "USDT", "10.5 USDT"],
  [null, null, "—"],
])("formatAmount(%s, %s) → %s", (amount, currency, expected) => {
  expect(formatAmount(amount, currency)).toBe(expected);
});
