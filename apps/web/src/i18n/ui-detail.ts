import type { SiteLocale } from "@tgbox/shared";

/** Strings for the entry detail page (merged with `ui(locale).detail`). */
const zh = {
  back: "返回{kind}导航",
  go: "直达",
  copyLink: "复制链接",
  linkCopied: "链接已复制",
  qr: "二维码",
  about: "{kind}简介与描述",
  monthlyUsers: "月活用户",
  onlineNow: "{n} 在线",
  noActivity: "暂无数据",
  promo: "推广",
  trendDays: "近 {n} 天",
  trendEmpty: "成员数据正在积累，过几天再来看看。",
  trendPoints: "{n} 次采样",
  expand: "展开全文",
  collapse: "收起",
  relatedChannels: "相关频道推荐",
  relatedGroups: "相关群组推荐",
};

const en: typeof zh = {
  back: "Back to {kind}",
  go: "Open",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  qr: "QR code",
  about: "About this {kind}",
  monthlyUsers: "Monthly users",
  onlineNow: "{n} online",
  noActivity: "No data",
  promo: "Sponsored",
  trendDays: "{n} days",
  trendEmpty: "Member history is still being collected — check back in a few days.",
  trendPoints: "{n} samples",
  expand: "Show more",
  collapse: "Show less",
  relatedChannels: "Related channels",
  relatedGroups: "Related groups",
};

const dictionaries: Record<SiteLocale, typeof zh> = { zh, "zh-hant": zh, en };

export function detailUi(locale: SiteLocale) {
  return dictionaries[locale];
}
