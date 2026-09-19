import type { ProductKind, SiteLocale } from "@tgbox/shared";

type Placement = { name: string; effect: string; includes: string | null };

const zh = {
  title: "广告投放",
  metaTitle: "Telegram 频道推广 · 广告位介绍 | TGbox",
  description:
    "给你已收录的频道、群组或机器人买一个更靠前的位置，或者在首页和全站顶部投放品牌广告。这里是每种广告位的效果示意和剩余名额，价格在机器人里查看。",
  entryFamily: "推广我的条目",
  entryFamilyLead:
    "给已经收录的频道、群组或机器人加曝光。付款后立即生效，每一档都包含上一档的效果。",
  adFamily: "投放品牌广告",
  adFamilyLead: "推广任意链接，不要求收录。内容经人工审核后上线，不通过全额退款。",
  placements: {
    highlight: {
      name: "高亮",
      effect: "在所有列表里用金色底和「推广」角标突出显示，位置不变。",
      includes: null,
    },
    category_pin: {
      name: "分类置顶",
      effect: "在自己所在分类的列表里排第一位。",
      includes: "含高亮效果",
    },
    pin: {
      name: "全站置顶",
      effect: "首页热门榜、频道 / 群组 / 机器人总览和分类页都排在最前。",
      includes: "含高亮效果和分类置顶",
    },
    banner: {
      name: "首页横幅",
      effect: "首页赞助区的大卡片，并出现在每个详情页的侧栏。可以带一张配图。",
      includes: null,
    },
    announcement: {
      name: "顶部公告条",
      effect: "全站每一页顶部的一行文字链接，独占一个名额。",
      includes: null,
    },
  } satisfies Record<ProductKind, Placement>,
  days: "{n} 天",
  slotsLeft: "共 {slots} 个名额 · 剩 {left} 个",
  slotsFull: "名额已满 · 到期后开放",
  slotsPerCategory: "每个分类 {slots} 个名额",
  durations: "可选时长：{days}",
  preview: "效果示意",
  sampleTitle: "你的频道",
  sampleDescription: "你的频道简介会显示在这里",
  bannerTitle: "你的品牌",
  bannerSubtitle: "一句话介绍，最多 40 字",
  announcementText: "你的公告 · 一句话介绍，点击直达你的链接",
  buy: "在机器人里看价格并购买",
  buyHint: "打开 @{bot}，发送 /promote 选择档位；也可以在机器人的小程序里购买。",
  faqTitle: "常见问题",
  faq: [
    {
      q: "怎么付款？",
      a: "支持 Telegram Stars 和 USDT。在机器人里选好档位后按提示付款，不需要注册。",
    },
    {
      q: "多久生效？",
      a: "条目推广付款后立即生效，网站几分钟内更新。品牌广告在管理员审核通过后上线。",
    },
    {
      q: "会标注是广告吗？",
      a: "会。所有推广位都显示「推广」字样，这是法规要求，也让访客更信任你的内容。",
    },
    {
      q: "能看到效果吗？",
      a: "横幅和公告条会统计点击数，在小程序的「我的订单」里随时查看。到期前一天机器人会提醒你续期。",
    },
    {
      q: "什么内容不能投？",
      a: "和收录标准一样：违法违规、色情、诈骗、赌博等内容一律不接，审核不通过的品牌广告会退款。",
    },
  ],
};

const en: typeof zh = {
  title: "Advertise",
  metaTitle: "Promote a Telegram channel · Ad placements | TGbox",
  description:
    "Move your listed channel, group or bot up the lists, or run a brand ad on the home page and at the top of every page. This page previews every placement and its free slots; prices are in the bot.",
  entryFamily: "Promote my listing",
  entryFamilyLead:
    "More exposure for a channel, group or bot that is already listed. Live as soon as you pay; each tier includes the one before it.",
  adFamily: "Run a brand ad",
  adFamilyLead:
    "Promote any link, listed or not. Ads go live after a manual review, and are refunded in full if rejected.",
  placements: {
    highlight: {
      name: "Highlight",
      effect: "A gold tint and a “Promoted” tag in every list, without changing position.",
      includes: null,
    },
    category_pin: {
      name: "Category pin",
      effect: "First place in the lists of its own category.",
      includes: "Includes the highlight",
    },
    pin: {
      name: "Site-wide pin",
      effect:
        "First on the home page hot lists, the channel / group / bot overviews and category pages.",
      includes: "Includes the highlight and the category pin",
    },
    banner: {
      name: "Home banner",
      effect:
        "A large card in the home page sponsor row, also shown beside every detail page. Can carry an image.",
      includes: null,
    },
    announcement: {
      name: "Top announcement bar",
      effect: "One line of text with your link at the top of every page. A single slot.",
      includes: null,
    },
  },
  days: "{n} days",
  slotsLeft: "{slots} slots · {left} left",
  slotsFull: "Fully booked · opens when one ends",
  slotsPerCategory: "{slots} slots per category",
  durations: "Durations: {days}",
  preview: "Preview",
  sampleTitle: "Your channel",
  sampleDescription: "Your channel description shows here",
  bannerTitle: "Your brand",
  bannerSubtitle: "One line, up to 40 characters",
  announcementText: "Your announcement · one line that links straight to you",
  buy: "See prices and buy in the bot",
  buyHint: "Open @{bot} and send /promote to pick a placement, or buy in the bot's Mini App.",
  faqTitle: "FAQ",
  faq: [
    {
      q: "How do I pay?",
      a: "Telegram Stars or USDT. Pick a placement in the bot and follow the prompts; no account needed.",
    },
    {
      q: "When does it go live?",
      a: "Listing promotions go live as soon as you pay and the site updates within minutes. Brand ads go live once an admin approves them.",
    },
    {
      q: "Is it labelled as an ad?",
      a: "Yes. Every placement carries a “Promoted” label; the law requires it, and visitors trust clearly marked ads more.",
    },
    {
      q: "Can I see results?",
      a: "Banners and the announcement bar count their clicks; see them any time under “My orders” in the Mini App. The bot reminds you a day before it ends.",
    },
    {
      q: "What can't be advertised?",
      a: "The same as our listing criteria: nothing illegal, adult, scam or gambling related. Rejected brand ads are refunded.",
    },
  ],
};

const dictionaries: Record<SiteLocale, typeof zh> = { zh, "zh-hant": zh, en };

export function advertiseUi(locale: SiteLocale) {
  return dictionaries[locale];
}
