import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  clickDay,
  clicksByPromotion,
  clicksForPromotion,
  createDb,
  dayBefore,
  recordClick,
} from "./index.ts";

const db = createDb(env.DB);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM promotion_clicks").run();
});

test("a click costs exactly one row written, whether the day is new or not", async () => {
  expect(await recordClick(db, { promotionId: 7, day: "2026-09-17" })).toEqual({ rowsWritten: 1 });
  expect(await recordClick(db, { promotionId: 7, day: "2026-09-17" })).toEqual({ rowsWritten: 1 });
  expect(await recordClick(db, { promotionId: 7, day: "2026-09-18" })).toEqual({ rowsWritten: 1 });

  expect(await clicksForPromotion(db, 7, "2026-09-01")).toEqual([
    { day: "2026-09-17", clicks: 2 },
    { day: "2026-09-18", clicks: 1 },
  ]);
});

test("totals and the recent window are aggregated per promotion in one query", async () => {
  const clicks = async (promotionId: number, day: string, times: number) => {
    for (let i = 0; i < times; i++) await recordClick(db, { promotionId, day });
  };
  await clicks(1, "2026-09-01", 5); // outside the window
  await clicks(1, "2026-09-11", 3);
  await clicks(1, "2026-09-17", 2);
  await clicks(2, "2026-09-16", 4);

  // Last 7 days ending 2026-09-17 → from 2026-09-11.
  expect(await clicksByPromotion(db, [1, 2, 3], "2026-09-11")).toEqual([
    { promotionId: 1, total: 10, recent: 5 },
    { promotionId: 2, total: 4, recent: 4 },
  ]);
  // A promotion nobody clicked simply has no row; callers fill in the zero.
  expect(await clicksByPromotion(db, [3], "2026-09-11")).toEqual([]);
  expect(await clicksByPromotion(db, [], "2026-09-11")).toEqual([]);
});

test("clicks of one promotion are cut off at sinceDay and never mixed with another's", async () => {
  await recordClick(db, { promotionId: 1, day: "2026-09-09" });
  await recordClick(db, { promotionId: 1, day: "2026-09-15" });
  await recordClick(db, { promotionId: 2, day: "2026-09-15" });

  expect(await clicksForPromotion(db, 1, "2026-09-10")).toEqual([{ day: "2026-09-15", clicks: 1 }]);
});

test.each([
  [Date.UTC(2026, 8, 17, 23, 59, 59), "2026-09-17"],
  [Date.UTC(2026, 8, 18, 0, 0, 0), "2026-09-18"],
])("clickDay(%i) is the UTC calendar day → %s", (ms, day) => {
  expect(clickDay(ms)).toBe(day);
});

test.each([
  ["2026-09-17", 0, "2026-09-17"],
  ["2026-09-17", 6, "2026-09-11"],
  ["2026-03-01", 1, "2026-02-28"],
])("dayBefore(%s, %i) → %s", (day, days, expected) => {
  expect(dayBefore(day, days)).toBe(expected);
});
