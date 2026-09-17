import type { Locale } from "@tgbox/shared";
import { expect, test } from "vitest";
import { formatDate, formatNumber } from "./format.ts";

const exact: [number, Locale, string][] = [
  [1234567, "zh", "1,234,567"],
  [1234567, "en", "1,234,567"],
];
test.each(exact)("formatNumber(%d, %s) → %s", (value, locale, expected) => {
  expect(formatNumber(value, locale)).toBe(expected);
});

const compact: [number, Locale, string][] = [
  [12_345, "zh", "1.2万"],
  [12_345, "en", "12.3K"],
  [980, "en", "980"],
];
test.each(compact)("compact formatNumber(%d, %s) → %s", (value, locale, expected) => {
  expect(formatNumber(value, locale, { compact: true })).toBe(expected);
});

test("formatDate renders a calendar date per locale in UTC", () => {
  expect(formatDate("2026-09-17T23:30:00Z", "zh")).toBe("2026年9月17日");
  expect(formatDate("2026-09-17T23:30:00Z", "en")).toBe("Sep 17, 2026");
});
