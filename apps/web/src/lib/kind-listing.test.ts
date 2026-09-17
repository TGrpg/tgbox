import type { EntryView } from "@tgbox/shared";
import { expect, test } from "vitest";
import { devSiteData } from "./dev-site-data.ts";
import {
  categoryListingBase,
  categoryListingPaths,
  kindSections,
  relatedTags,
  sortEntries,
} from "./kind-listing.ts";

function entry(overrides: Partial<EntryView> & Pick<EntryView, "username">): EntryView {
  const base = devSiteData.entries[0];
  if (!base) throw new Error("dev data has entries");
  return { ...base, tags: [], ...overrides };
}

test("members order puts the largest first, latest order the newest listing first", () => {
  const entries = [
    entry({ username: "b", members: 10, listedAt: "2026-01-03T00:00:00.000Z" }),
    entry({ username: "a", members: 30, listedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ username: "c", members: null, listedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  expect(sortEntries(entries, "members").map((item) => item.username)).toEqual(["a", "b", "c"]);
  expect(sortEntries(entries, "latest").map((item) => item.username)).toEqual(["b", "c", "a"]);
});

test("promoted entries lead both orders, keeping the order among themselves", () => {
  const entries = [
    entry({
      username: "big",
      members: 90,
      listedAt: "2026-01-03T00:00:00.000Z",
      isPromoted: false,
    }),
    entry({
      username: "pin-small",
      members: 5,
      listedAt: "2026-01-01T00:00:00.000Z",
      isPromoted: true,
    }),
    entry({
      username: "pin-mid",
      members: 20,
      listedAt: "2026-01-02T00:00:00.000Z",
      isPromoted: true,
    }),
    entry({
      username: "mid",
      members: 50,
      listedAt: "2026-01-04T00:00:00.000Z",
      isPromoted: false,
    }),
  ];
  expect(sortEntries(entries, "members").map((item) => item.username)).toEqual([
    "pin-mid",
    "pin-small",
    "big",
    "mid",
  ]);
  expect(sortEntries(entries, "latest").map((item) => item.username)).toEqual([
    "pin-mid",
    "pin-small",
    "mid",
    "big",
  ]);
});

test("category listings are built for both sort orders, each paginated", () => {
  const data = {
    ...devSiteData,
    categories: [
      {
        id: 1,
        slug: "tech",
        kind: "channel" as const,
        nameZh: "科技",
        nameEn: "Tech",
        sort: 1,
        icon: null,
        count: 61,
      },
      {
        id: 2,
        slug: "empty",
        kind: "channel" as const,
        nameZh: "空",
        nameEn: "Empty",
        sort: 2,
        icon: null,
        count: 0,
      },
    ],
  };
  const params = categoryListingPaths(data).map((path) => path.params.page);
  expect(params).toEqual([undefined, "2", "latest", "latest/2"]);
  expect(categoryListingPaths(data)[3]?.props).toMatchObject({ sort: "latest", page: 2 });
  expect(categoryListingBase("channel", "tech", "members")).toBe("/channel/tech/");
  expect(categoryListingBase("channel", "tech", "latest")).toBe("/channel/tech/latest/");
});

test("kind sections skip empty categories and cap entries per section", () => {
  const entries = Array.from({ length: 12 }, (_, index) =>
    entry({ username: `n${index}`, kind: "channel", category: "news", members: index }),
  );
  const data = {
    ...devSiteData,
    categories: [
      {
        id: 1,
        slug: "news",
        kind: "channel" as const,
        nameZh: "新闻",
        nameEn: "News",
        sort: 1,
        icon: null,
        count: 12,
      },
      {
        id: 2,
        slug: "tech",
        kind: "channel" as const,
        nameZh: "科技",
        nameEn: "Tech",
        sort: 2,
        icon: null,
        count: 0,
      },
      {
        id: 3,
        slug: "vps",
        kind: "group" as const,
        nameZh: "VPS",
        nameEn: "VPS",
        sort: 1,
        icon: null,
        count: 3,
      },
    ],
    entries,
  };
  const sections = kindSections(data, "channel", 10);
  expect(sections.map((section) => section.category.slug)).toEqual(["news"]);
  expect(sections[0]?.entries).toHaveLength(10);
  expect(sections[0]?.entries[0]?.username).toBe("n11");
});

test("related tags are ranked by how often they co-occur with the tag", () => {
  const data = {
    ...devSiteData,
    tags: [
      { id: 1, slug: "ai", nameZh: "AI", nameEn: "AI", count: 3 },
      { id: 2, slug: "code", nameZh: "编程", nameEn: "Code", count: 2 },
      { id: 3, slug: "news", nameZh: "新闻", nameEn: "News", count: 1 },
      { id: 4, slug: "lonely", nameZh: "孤", nameEn: "Lonely", count: 1 },
    ],
    entries: [
      entry({ username: "x", tags: ["ai", "code", "news"] }),
      entry({ username: "y", tags: ["ai", "code"] }),
      entry({ username: "z", tags: ["ai"] }),
      entry({ username: "w", tags: ["lonely"] }),
    ],
  };
  expect(relatedTags(data, "ai").map((tag) => tag.slug)).toEqual(["code", "news"]);
  expect(relatedTags(data, "ai", 1).map((tag) => tag.slug)).toEqual(["code"]);
});
