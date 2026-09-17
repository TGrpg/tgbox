import { categories } from "@tgbox/shared";
import { expect, test } from "vitest";
import { categoryIcon } from "./category-icons.ts";

test.each(categories.map((category) => [category.kind, category.slug]))(
  "%s category %s without an icon falls back to its own slug icon",
  (_, slug) => {
    expect(categoryIcon({ slug, icon: null })).not.toBe("category");
  },
);

test("the icon stored in D1 wins over the slug fallback", () => {
  expect(categoryIcon({ slug: "news", icon: "sparkles" })).toBe("sparkles");
});

test("unknown icon keys and slugs fall back to a generic icon", () => {
  expect(categoryIcon({ slug: "news", icon: "not-an-icon" })).toBe("news");
  expect(categoryIcon({ slug: "unknown-slug", icon: null })).toBe("category");
});
