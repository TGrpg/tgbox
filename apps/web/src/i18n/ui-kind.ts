import type { Locale } from "@tgbox/shared";

/** Strings for the kind index, category and tag listing pages. */
const zh = {
  directory: "{kind}导航",
  viewAll: "查看全部（共 {n} 个）",
  entries: "{n} 个条目",
  sortLabel: "排序方式",
  sort: { members: "成员数", latest: "最新收录" },
  latestTitle: "最新收录",
  relatedTags: "相关标签",
  tagCount: "{n} 个",
  emptyCategory: "暂无条目",
};

const en: typeof zh = {
  directory: "{kind} directory",
  viewAll: "View all ({n})",
  entries: "{n} entries",
  sortLabel: "Sort by",
  sort: { members: "Members", latest: "Newest" },
  latestTitle: "Newest",
  relatedTags: "Related tags",
  tagCount: "{n}",
  emptyCategory: "No entries yet",
};

const dictionaries: Record<Locale, typeof zh> = { zh, en };

export function kindUi(locale: Locale) {
  return dictionaries[locale];
}
