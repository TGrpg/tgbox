import { expect, test } from "vitest";
import { activitySegments, areaChart, memberDelta } from "./detail-trend.ts";

const day = (n: number, members: number) => ({
  t: new Date(Date.UTC(2026, 0, 1 + n)).toISOString(),
  members,
});

test("area chart draws the line and closes the area along the bottom edge", () => {
  const chart = areaChart([10, 20, 15], 100, 20);
  expect(chart?.line).toBe("M0,20 L50,0 L100,10");
  expect(chart?.area).toBe("M0,20 L50,0 L100,10 L100,20 L0,20 Z");
  expect(chart?.end).toEqual({ x: 100, y: 10 });
});

test("a flat series is drawn through the middle", () => {
  expect(areaChart([5, 5], 100, 20)?.line).toBe("M0,10 L100,10");
});

test("area chart needs at least two points", () => {
  expect(areaChart([5], 100, 20)).toBeNull();
});

test("member delta compares the latest point with the last point at or before the window start", () => {
  const history = [day(0, 100), day(20, 150), day(24, 170), day(30, 200)];
  expect(memberDelta(history, 7)).toBe(50);
  expect(memberDelta(history, 30)).toBe(100);
});

test("member delta is null when history does not reach back far enough", () => {
  expect(memberDelta([day(25, 100), day(30, 120)], 7)).toBeNull();
  expect(memberDelta([day(30, 120)], 7)).toBeNull();
});

test("activity tier fills that many of four segments", () => {
  expect(activitySegments(0)).toEqual([false, false, false, false]);
  expect(activitySegments(3)).toEqual([true, true, true, false]);
  expect(activitySegments(null)).toEqual([false, false, false, false]);
});
