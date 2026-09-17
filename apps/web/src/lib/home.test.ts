import { expect, test } from "vitest";
import { devSiteData } from "./dev-site-data.ts";
import { hotCategories, hotPool, latestEntries } from "./home.ts";

test("hot categories are the largest non-empty categories, one per slug", () => {
  const top = hotCategories(devSiteData.categories, 6);
  expect(top.length).toBeGreaterThan(0);
  expect(top.length).toBeLessThanOrEqual(6);
  expect(top.every((category) => category.count > 0)).toBe(true);
  const counts = top.map((category) => category.count);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  const slugs = top.map((category) => category.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

test("hot pool holds promoted, then the biggest entries of one kind with only what a row shows", () => {
  const pool = hotPool(devSiteData.entries, "channel", 50);
  const channels = devSiteData.entries.filter((entry) => entry.kind === "channel");
  expect(pool).toHaveLength(Math.min(50, channels.length));
  // "telegram" is the dev dataset's promoted channel; "durov" is the largest.
  expect(pool[0]).toEqual({
    u: "telegram",
    t: "Telegram News",
    v: true,
    a: null,
    m: 9_870_000,
    p: true,
  });
  expect(pool[1]).toMatchObject({ u: "durov", m: 12_480_000, p: false });
  const members = pool.filter((item) => !item.p).map((item) => item.m ?? -1);
  expect(members).toEqual([...members].sort((a, b) => b - a));
  expect(hotPool(devSiteData.entries, "channel", 1)).toHaveLength(1);
});

test("latest entries are newest listed first", () => {
  const latest = latestEntries(devSiteData.entries, 3);
  expect(latest).toHaveLength(3);
  const dates = latest.map((entry) => entry.listedAt);
  expect(dates).toEqual([...dates].sort().reverse());
});
