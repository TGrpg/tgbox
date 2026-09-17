import type { EntryKind, Locale } from "@tgbox/shared";

const zh = {
  searchPlaceholder: "搜索频道、群组、机器人…",
  hotCategories: "热门分类",
  sponsored: "赞助商推广",
  dismissPromos: "隐藏推广",
  hot: { channel: "热门频道", group: "热门群组", bot: "热门机器人" } satisfies Record<
    EntryKind,
    string
  >,
  shuffle: "换一换",
  latest: "最新收录",
  latestDescription: "最近通过审核上线的条目",
  statsLabel: "收录统计",
  total: "已收录",
  ctaEyebrow: "免费收录",
  ctaTitle: "有好的频道、群组或机器人？",
  ctaText: "私聊收录机器人发送链接即可提交，审核通过后几分钟内上线。",
  ctaButton: "打开收录机器人",
  ctaGuide: "查看收录说明",
  more: "查看全部",
  rankings: "查看排行榜",
};

const en: typeof zh = {
  searchPlaceholder: "Search channels, groups, bots…",
  hotCategories: "Popular categories",
  sponsored: "Sponsored",
  dismissPromos: "Hide sponsored",
  hot: { channel: "Top channels", group: "Top groups", bot: "Top bots" },
  shuffle: "Shuffle",
  latest: "Just added",
  latestDescription: "Entries that recently passed review",
  statsLabel: "Directory stats",
  total: "Listed",
  ctaEyebrow: "Free listing",
  ctaTitle: "Know a great channel, group or bot?",
  ctaText: "Send the link to our bot in a private chat — approved entries go live within minutes.",
  ctaButton: "Open the submit bot",
  ctaGuide: "How submission works",
  more: "View all",
  rankings: "See the rankings",
};

const dictionaries: Record<Locale, typeof zh> = { zh, en };

export function homeUi(locale: Locale) {
  return dictionaries[locale];
}
