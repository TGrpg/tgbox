import type { Locale } from "@tgbox/shared";
import { describe, expect, test } from "vitest";
import { alternatePaths, getLocale, localizePath } from "./locale.ts";

const cases: [string, Locale, string][] = [
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
];

test.each(cases)("localizePath(%s, %s) → %s", (path, locale, expected) => {
  expect(localizePath(path, locale)).toBe(expected);
});

test("alternatePaths maps a page to both language versions", () => {
  expect(alternatePaths("/en/channel/news/")).toEqual({
    zh: "/channel/news/",
    en: "/en/channel/news/",
  });
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
  });
});
