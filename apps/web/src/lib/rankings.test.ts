import { type EntryView, RankingsData, type SiteData } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { devSiteData } from "./dev-site-data.ts";
import { buildRankings, formatGrowth, memberGrowth, RANK_LIMIT } from "./rankings.ts";

const now = new Date("2026-09-15T03:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function entry(username: string, overrides: Partial<EntryView> = {}): EntryView {
  return {
    username,
    kind: "channel",
    category: "tech",
    tags: [],
    title: username,
    description: "",
    descriptionZh: null,
    descriptionEn: null,
    lang: null,
    verified: false,
    avatarUrl: null,
    members: 1000,
    online: null,
    activityTier: null,
    tgCreatedAt: null,
    listedAt: daysAgo(60),
    updatedAt: daysAgo(60),
    promo: null,
    posts: [],
    memberHistory: [],
    related: { channels: [], groups: [] },
    ...overrides,
  };
}

function site(entries: EntryView[]): SiteData {
  return { ...devSiteData, entries };
}

const history = (...points: [days: number, members: number][]) =>
  points.map(([days, members]) => ({ t: daysAgo(days), members }));

describe("memberGrowth", () => {
  const points = history([35, 800], [21, 900], [14, 950], [7.1, 1000], [0.5, 1150]);

  test.each([
    { days: 6, growth: 200, growthPct: 20 },
    { days: 27, growth: 400, growthPct: 50 },
  ])("compares with the latest point at least $days days old", ({ days, growth, growthPct }) => {
    expect(memberGrowth(1200, points, now, days)).toEqual({ growth, growthPct });
  });

  test("a point just short of a week still counts as a week-old base", () => {
    expect(memberGrowth(1100, history([6.8, 1000]), now, 6)).toEqual({
      growth: 100,
      growthPct: 10,
    });
  });

  test("no base point old enough, no history or no member count gives null", () => {
    expect(memberGrowth(1200, history([3, 1000]), now, 6)).toBeNull();
    expect(memberGrowth(1200, [], now, 6)).toBeNull();
    expect(memberGrowth(null, points, now, 6)).toBeNull();
  });

  test("percent is rounded to one decimal and null against a zero base", () => {
    expect(memberGrowth(1333, history([8, 1200]), now, 6)).toEqual({
      growth: 133,
      growthPct: 11.1,
    });
    expect(memberGrowth(50, history([8, 0]), now, 6)).toEqual({ growth: 50, growthPct: null });
  });
});

describe("buildRankings", () => {
  test("growth lists hold only positive growth, largest first, kinds mixed", () => {
    const data = buildRankings(
      site([
        entry("small", { members: 1100, memberHistory: history([10, 1000]) }),
        entry("big", { kind: "group", members: 5000, memberHistory: history([10, 4000]) }),
        entry("shrinking", { members: 900, memberHistory: history([10, 1000]) }),
        entry("flat", { members: 1000, memberHistory: history([10, 1000]) }),
        entry("fresh", { members: 1000, memberHistory: history([2, 10]) }),
        entry("monthly", { kind: "bot", members: 3000, memberHistory: history([30, 1000]) }),
      ]),
      now,
    );
    expect(data.weeklyGrowth.map((item) => item.username)).toEqual(["monthly", "big", "small"]);
    expect(data.weeklyGrowth[1]).toMatchObject({ kind: "group", growth: 1000, growthPct: 25 });
    expect(data.monthlyGrowth.map((item) => item.username)).toEqual(["monthly"]);
    expect(data.monthlyGrowth[0]).toMatchObject({ growth: 2000, growthPct: 200 });
    expect(data.generatedAt).toBe(now.toISOString());
  });

  test("without old enough history the growth lists are empty", () => {
    const data = buildRankings(
      site([entry("a"), entry("b", { memberHistory: history([1, 5]) })]),
      now,
    );
    expect(data.weeklyGrowth).toEqual([]);
    expect(data.monthlyGrowth).toEqual([]);
    expect(data.newest).toHaveLength(2);
  });

  test("newest is by listing date; active is by tier then members, dormant and untiered left out", () => {
    const data = buildRankings(
      site([
        entry("old", { listedAt: daysAgo(30), activityTier: 4, members: 10 }),
        entry("new", { listedAt: daysAgo(1), activityTier: 3, members: 99_999 }),
        entry("mid", { listedAt: daysAgo(5), activityTier: 4, members: 500 }),
        entry("dormant", { listedAt: daysAgo(3), activityTier: 0 }),
        entry("group", { kind: "group", listedAt: daysAgo(2), activityTier: null }),
      ]),
      now,
    );
    expect(data.newest.map((item) => item.username)).toEqual([
      "new",
      "group",
      "dormant",
      "mid",
      "old",
    ]);
    expect(data.active.map((item) => item.username)).toEqual(["mid", "old", "new"]);
  });

  test("promoted entries are not moved up", () => {
    const data = buildRankings(
      site([
        entry("pinned", { promo: "pin", members: 1010, memberHistory: history([8, 1000]) }),
        entry("grower", { members: 2000, memberHistory: history([8, 1000]) }),
      ]),
      now,
    );
    expect(data.weeklyGrowth.map((item) => item.username)).toEqual(["grower", "pinned"]);
  });

  test("each list is capped and the result satisfies the rankings contract", () => {
    const many = Array.from({ length: RANK_LIMIT + 20 }, (_, index) =>
      entry(`e${index}`, {
        members: 1000 + index,
        activityTier: 2,
        memberHistory: history([40, 900], [8, 1000]),
      }),
    );
    const data = RankingsData.parse(buildRankings(site(many), now));
    for (const list of [data.weeklyGrowth, data.monthlyGrowth, data.newest, data.active]) {
      expect(list).toHaveLength(RANK_LIMIT);
    }
    expect(data.weeklyGrowth[0]?.username).toBe(`e${RANK_LIMIT + 19}`);
  });
});

test.each([
  { growth: 1234, growthPct: 5.2, locale: "zh", text: "+1,234 (+5.2%)" },
  { growth: 50, growthPct: null, locale: "en", text: "+50" },
  { growth: 12, growthPct: 100, locale: "en", text: "+12 (+100%)" },
] as const)("growth reads as $text", ({ growth, growthPct, locale, text }) => {
  expect(formatGrowth(growth, growthPct, locale)).toBe(text);
});
