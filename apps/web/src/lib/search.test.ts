import { describe, expect, test } from "vitest";
import { externalSearchUrls, safeExcerpt } from "./search.ts";

describe("safeExcerpt", () => {
  test.each([
    ["每日<mark>科技</mark>新闻", "每日<mark>科技</mark>新闻"],
    ["<img src=x onerror=alert(1)>hi", "hi"],
    ['a &lt;b&gt; <mark class="x">c</mark>', "a &lt;b&gt; <mark>c</mark>"],
  ])("%s", (input, expected) => {
    expect(safeExcerpt(input)).toBe(expected);
  });
});

test("external search links restrict the query to the site host", () => {
  const urls = externalSearchUrls("科技 频道", "https://nav.example.org/");
  expect(new URL(urls.google).searchParams.get("q")).toBe("site:nav.example.org 科技 频道");
  expect(urls.google.startsWith("https://www.google.com/search?")).toBe(true);
  expect(new URL(urls.bing).searchParams.get("q")).toBe("site:nav.example.org 科技 频道");
  expect(urls.bing.startsWith("https://www.bing.com/search?")).toBe(true);
});
