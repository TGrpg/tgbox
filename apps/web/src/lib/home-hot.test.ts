import { expect, test } from "vitest";
import { avatarTint, HOT_PAGE_SIZE, hotPage, parseHotPool } from "./home-hot.ts";

test("hot pages cycle through the pool and wrap to the start", () => {
  const pool = Array.from({ length: 25 }, (_, index) => index);
  expect(hotPage(pool, 0)).toEqual(pool.slice(0, HOT_PAGE_SIZE));
  expect(hotPage(pool, 2)).toEqual([20, 21, 22, 23, 24]);
  expect(hotPage(pool, 3)).toEqual(pool.slice(0, HOT_PAGE_SIZE));
  expect(hotPage([], 4)).toEqual([]);
});

test("a fetched pool keeps only well-formed items", () => {
  const good = { u: "durov", t: "Durov", v: true, a: null, m: 5 };
  expect(parseHotPool([good, { u: "x" }, null, { ...good, m: "5" }])).toEqual([good]);
  expect(parseHotPool({ items: [good] })).toEqual([]);
});

test("avatar tint is a stable gradient pair per title", () => {
  expect(avatarTint("Telegram")).toEqual(avatarTint("Telegram"));
  expect(avatarTint("Telegram")).toHaveLength(2);
  expect(avatarTint("Telegram")[0]).toMatch(/^from-\[#/);
});
