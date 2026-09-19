import type { SiteLocale } from "@tgbox/shared";

/** Strings for the kind index, category and tag listing pages. */
const zh = {
  directory: "{kind}导航",
  viewAll: "查看全部（共 {n} 个）",
  entries: "{n} 个条目",
  sortLabel: "排序方式",
  sort: { members: "成员数", latest: "最新收录" },
  latestTitle: "最新收录",
  relatedTags: "相关标签",
  /** Client-side language filter on the kind and category listings. */
  langFilter: { label: "按语言筛选", all: "全部语言" },
  tagFilter: { label: "按标签筛选", all: "全部标签", empty: "没有同时符合这两个条件的条目。" },
  /** Tag index: the two facet groups tags are shown under. */
  facets: { topic: "主题", attribute: "属性" },
  tagsIndexCount: "{n} 个标签",
  tagsIndexEmpty: "还没有条目用到标签。",
  tagCount: "{n} 个",
};

const en: typeof zh = {
  directory: "{kind} directory",
  viewAll: "View all ({n})",
  entries: "{n} entries",
  sortLabel: "Sort by",
  sort: { members: "Members", latest: "Newest" },
  latestTitle: "Newest",
  relatedTags: "Related tags",
  langFilter: { label: "Filter by language", all: "All languages" },
  tagFilter: {
    label: "Filter by tag",
    all: "All tags",
    empty: "Nothing here matches both filters.",
  },
  facets: { topic: "Topics", attribute: "Attributes" },
  tagsIndexCount: "{n} tags",
  tagsIndexEmpty: "No entry uses a tag yet.",
  tagCount: "{n}",
};

const dictionaries: Record<SiteLocale, typeof zh> = { zh, "zh-hant": zh, en };

export function kindUi(locale: SiteLocale) {
  return dictionaries[locale];
}
