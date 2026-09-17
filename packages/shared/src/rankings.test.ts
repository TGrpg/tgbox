import { expect, test } from "vitest";
import { RankingsData } from "./rankings.ts";

test("rankings JSON parses with nullable stats", () => {
  const item = {
    username: "news",
    kind: "channel",
    title: "News",
    members: null,
    growth: 12,
    growthPct: null,
    listedAt: "2026-09-16T00:00:00.000Z",
    activityTier: null,
  };
  const data = {
    generatedAt: "2026-09-17T00:00:00.000Z",
    weeklyGrowth: [item],
    monthlyGrowth: [],
    newest: [item],
    active: [],
  };
  expect(RankingsData.parse(data)).toEqual(data);
  expect(RankingsData.safeParse({ ...data, newest: [{ ...item, kind: "user" }] }).success).toBe(
    false,
  );
});
