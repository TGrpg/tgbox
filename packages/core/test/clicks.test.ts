import { env } from "cloudflare:workers";
import {
  HISTORY_DAYS,
  promotionClickHistory,
  promotionClickTotals,
  RECENT_DAYS,
} from "@tgbox/core";
import { recordClick } from "@tgbox/db";
import { beforeEach, expect, test } from "vitest";
import { db, NOW, setup } from "./fake.ts";

// NOW is 2026-09-17T00:00:00Z, so "today" is 2026-09-17 and the 7-day window opens on 09-11.
const day = (offset: number) =>
  new Date(NOW + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM promotion_clicks").run();
});

async function clicks(promotionId: number, dayOffset: number, times: number) {
  for (let i = 0; i < times; i++) await recordClick(db, { promotionId, day: day(dayOffset) });
}

test("every promotion gets a number, clicked or not, with a 7-day window", async () => {
  const { ctx } = await setup();
  await clicks(1, -30, 4);
  await clicks(1, -(RECENT_DAYS - 1), 2);
  await clicks(1, 0, 1);
  await clicks(2, -RECENT_DAYS, 9); // one day too old for the window

  expect(await promotionClickTotals(ctx, [1, 2, 3])).toEqual({
    1: { total: 7, recent: 3 },
    2: { total: 9, recent: 0 },
    3: { total: 0, recent: 0 },
  });
});

test("the history is zero-filled so every day has a bar, oldest first", async () => {
  const { ctx } = await setup();
  await clicks(5, -1, 3);
  await clicks(5, 0, 1);
  await clicks(5, -HISTORY_DAYS, 99); // outside the window

  const history = await promotionClickHistory(ctx, { promotionId: 5 });

  expect(history).toHaveLength(HISTORY_DAYS);
  expect(history.at(0)?.day).toBe(day(-(HISTORY_DAYS - 1)));
  expect(history.at(-1)).toEqual({ day: day(0), clicks: 1 });
  expect(history.at(-2)).toEqual({ day: day(-1), clicks: 3 });
  expect(history.reduce((sum, point) => sum + point.clicks, 0)).toBe(4);
});

test("a shorter window still ends today", async () => {
  const { ctx } = await setup();
  await clicks(5, -2, 2);

  expect(await promotionClickHistory(ctx, { promotionId: 5, days: 3 })).toEqual([
    { day: day(-2), clicks: 2 },
    { day: day(-1), clicks: 0 },
    { day: day(0), clicks: 0 },
  ]);
});
