import { expect, test } from "vitest";
import { FeaturedInput } from "./featured.ts";

const item = { name: "频道", url: "https://t.me/channel", descZh: "简介", descEn: "About" };

test("featured input accepts an ordered list up to 20 items and trims each field", () => {
  expect(FeaturedInput.parse({ featured: [] })).toEqual({ featured: [] });
  expect(FeaturedInput.parse({ featured: Array(20).fill(item) }).featured).toHaveLength(20);
  expect(FeaturedInput.parse({ featured: [{ ...item, name: "  频道  ", descEn: " " }] })).toEqual({
    featured: [{ ...item, descEn: "" }],
  });
});

test.each([
  { featured: Array(21).fill(item) },
  { featured: [{ ...item, name: " " }] },
  { featured: [{ ...item, url: "http://example.com" }] },
  { featured: [{ ...item, url: "javascript:alert(1)" }] },
  { featured: [{ ...item, descZh: "字".repeat(121) }] },
])("featured input refuses invalid rows or an oversized list", (input) => {
  expect(FeaturedInput.safeParse(input).success).toBe(false);
});
