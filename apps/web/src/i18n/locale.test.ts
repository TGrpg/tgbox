import type { SiteLocale } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { alternatePaths, getLocale, isNotFoundPath, localizePath } from "./locale.ts";

const cases: [string, SiteLocale, string][] = [
  ["/", "zh", "/"],
  ["/", "en", "/en/"],
  ["/about/", "en", "/en/about/"],
  ["/en/about/", "zh", "/about/"],
  ["/en/about/", "en", "/en/about/"],
  ["/en", "zh", "/"],
  ["/en/", "en", "/en/"],
  ["about/", "en", "/en/about/"],
  ["/english-tips/", "en", "/en/english-tips/"],
  ["/detail/foo/", "zh", "/detail/foo/"],
  ["/detail/foo/", "zh-hant", "/zh-hant/detail/foo/"],
  ["/en/about/", "zh-hant", "/zh-hant/about/"],
  ["/zh-hant/about/", "en", "/en/about/"],
  ["/zh-hant", "zh", "/"],
  ["/zh-hantai/", "zh", "/zh-hantai/"],
];

test.each(cases)("localizePath(%s, %s) → %s", (path, locale, expected) => {
  expect(localizePath(path, locale)).toBe(expected);
});

test("alternatePaths maps a page to every language version", () => {
  expect(alternatePaths("/en/channel/news/")).toEqual({
    zh: "/channel/news/",
    "zh-hant": "/zh-hant/channel/news/",
    en: "/en/channel/news/",
  });
});

test("isNotFoundPath recognises every locale's 404", () => {
  for (const path of ["/404.html", "/en/404.html", "/zh-hant/404.html", "/zh-hant/404/"]) {
    expect(isNotFoundPath(path), path).toBe(true);
  }
  expect(isNotFoundPath("/zh-hant/about/")).toBe(false);
});

describe("getLocale", () => {
  test("uses the routing locale when Astro knows it", () => {
    expect(getLocale({ currentLocale: "en", url: new URL("https://x.test/") })).toBe("en");
  });
  test("falls back to the URL prefix, defaulting to zh", () => {
    expect(getLocale({ currentLocale: undefined, url: new URL("https://x.test/en/404/") })).toBe(
      "en",
    );
    expect(getLocale({ currentLocale: undefined, url: new URL("https://x.test/enroll/") })).toBe(
      "zh",
    );
    expect(
      getLocale({ currentLocale: undefined, url: new URL("https://x.test/zh-hant/404/") }),
    ).toBe("zh-hant");
  });
});
