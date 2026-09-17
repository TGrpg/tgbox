import { expect, test } from "vitest";
import { activityTier } from "./activity.ts";

const now = new Date("2026-09-17T00:00:00Z");
const DAY = 86_400_000;

function postsEvery(days: number, count: number, views: number | null) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    date: new Date(now.getTime() - (i + 0.5) * days * DAY).toISOString(),
    text: "",
    views,
  }));
}

test.each([
  ["no posts", [], 0],
  ["only old posts", postsEvery(70, 3, 5000), 0],
  ["one post a month", postsEvery(25, 3, 5000), 1],
  ["weekly", postsEvery(6, 10, 5000), 2],
  ["daily", postsEvery(1, 20, 5000), 3],
  ["several a day (20-post page covers < 30 days)", postsEvery(0.2, 20, 5000), 4],
  ["several a day but barely read", postsEvery(0.2, 20, 20), 3],
  ["weekly with unknown views", postsEvery(6, 10, null), 2],
] as const)("%s", (_label, posts, expected) => {
  expect(activityTier([...posts], now)).toBe(expected);
});
