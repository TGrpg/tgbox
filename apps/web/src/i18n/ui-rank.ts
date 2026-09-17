import type { Locale } from "@tgbox/shared";

/** Strings for the rankings page. */
const zh = {
  title: "排行榜",
  heading: "Telegram 频道、群组与机器人排行榜",
  updated: "更新于 {date}",
  tabsLabel: "榜单",
  tabs: { weekly: "周涨粉", monthly: "月涨粉", newest: "最新收录", active: "最活跃" },
  kindsLabel: "类型",
  all: "全部",
  growthEmpty: "数据积累中，每周更新",
  empty: "这里暂时还没有条目。",
  kindEmpty: "该类型暂无上榜条目。",
  growthTitle: "较上次采样的成员变化",
};

const en: typeof zh = {
  title: "Rankings",
  heading: "Telegram channel, group & bot rankings",
  updated: "Updated {date}",
  tabsLabel: "Rankings",
  tabs: {
    weekly: "Weekly growth",
    monthly: "Monthly growth",
    newest: "Newest",
    active: "Most active",
  },
  kindsLabel: "Type",
  all: "All",
  growthEmpty: "Collecting data — updated weekly",
  empty: "Nothing listed here yet.",
  kindEmpty: "No ranked entries of this type yet.",
  growthTitle: "Member change since the earlier sample",
};

const dictionaries: Record<Locale, typeof zh> = { zh, en };

export function rankUi(locale: Locale) {
  return dictionaries[locale];
}
