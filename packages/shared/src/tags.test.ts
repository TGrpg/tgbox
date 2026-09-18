import { describe, expect, test } from "vitest";
import { categories } from "./categories.ts";
import { entryKinds } from "./domain.ts";
import { categoryTagHints, tagFacets, tags, tagsForCategory } from "./tags.ts";

const slugs = new Set(tags.map((tag) => tag.slug));

describe("the tag vocabulary", () => {
  test("every tag has a facet, and no facet names a tag that is gone", () => {
    expect(Object.keys(tagFacets).sort()).toEqual([...slugs].sort());
    for (const facet of Object.values(tagFacets)) {
      expect(["topic", "attribute"]).toContain(facet);
    }
  });

  test("slugs are unique", () => {
    expect(slugs.size).toBe(tags.length);
  });
});

describe("the category hints", () => {
  test("every hinted slug is a real tag", () => {
    for (const [key, hints] of Object.entries(categoryTagHints)) {
      expect({ key, unknown: hints.filter((slug) => !slugs.has(slug)) }).toEqual({
        key,
        unknown: [],
      });
      expect(new Set(hints).size).toBe(hints.length);
    }
  });

  test("every key names a category that exists", () => {
    const keys = new Set(categories.map((category) => `${category.kind}:${category.slug}`));
    expect(Object.keys(categoryTagHints).filter((key) => !keys.has(key))).toEqual([]);
  });

  test("every category except group:other hints at something", () => {
    const missing = categories
      .map((category) => `${category.kind}:${category.slug}`)
      .filter((key) => !(key in categoryTagHints));
    expect(missing).toEqual(["group:other"]);
  });

  test("the kinds are the only prefixes", () => {
    for (const key of Object.keys(categoryTagHints)) {
      expect(entryKinds).toContain(key.split(":")[0]);
    }
  });
});

describe("tagsForCategory", () => {
  const live = tags.map((tag, index) => ({ id: index + 1, slug: tag.slug }));

  test("hinted tags come out in hint order, the rest in the live order", () => {
    const { hinted, rest } = tagsForCategory("channel", "wallpaper", live);
    expect(hinted.map((tag) => tag.slug)).toEqual(["photography", "design", "anime", "ai-art"]);
    expect(rest.map((tag) => tag.slug)).toEqual(
      live.map((tag) => tag.slug).filter((slug) => !hinted.some((tag) => tag.slug === slug)),
    );
    expect(hinted.length + rest.length).toBe(live.length);
  });

  test("a category with no hints shows the whole vocabulary", () => {
    expect(tagsForCategory("group", "other", live)).toEqual({ hinted: [], rest: live });
    expect(tagsForCategory("group", null, live)).toEqual({ hinted: [], rest: live });
    // An admin-created category is the same case.
    expect(tagsForCategory("channel", "brand-new", live)).toEqual({ hinted: [], rest: live });
  });

  test("it intersects with D1, not with the seed list", () => {
    // A tag the admin added is unknown to every hint list, so it lands in `rest`…
    const added = { id: 999, slug: "podcasts-2" };
    const withAdded = [...live, added];
    const { hinted, rest } = tagsForCategory("channel", "wallpaper", withAdded);
    expect(rest).toContain(added);
    expect(hinted).not.toContain(added);

    // …and a hint naming a tag the admin retired is skipped, not invented.
    const withoutAiArt = live.filter((tag) => tag.slug !== "ai-art");
    expect(
      tagsForCategory("channel", "wallpaper", withoutAiArt).hinted.map((tag) => tag.slug),
    ).toEqual(["photography", "design", "anime"]);
  });
});
