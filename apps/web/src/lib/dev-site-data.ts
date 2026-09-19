import { categories, type EntryView, type SiteData, tags } from "@tgbox/shared";

type Optional =
  | "posts"
  | "memberHistory"
  | "related"
  | "tgCreatedAt"
  | "updatedAt"
  | "descriptionZh"
  | "descriptionEn";
type DevEntry = Omit<EntryView, Optional> & Partial<Pick<EntryView, Optional>>;

/** Tiny built-in dataset so `astro dev` / `astro build` work on a fresh clone without a snapshot. */
const devEntries: DevEntry[] = [
  {
    username: "telegram",
    kind: "channel",
    category: "news",
    tags: ["english"],
    title: "Telegram News",
    description:
      "The official Telegram on Telegram. Much recursion. Very Telegram. Wow.\nhttps://telegram.org",
    lang: "en",
    verified: true,
    avatarUrl: null,
    members: 9_870_000,
    online: null,
    activityTier: 2,
    tgCreatedAt: "2015-09-01T00:00:00.000Z",
    listedAt: "2026-09-12T00:00:00.000Z",
    promo: "pin",
    posts: [
      {
        id: 2,
        date: "2026-09-10T12:00:00.000Z",
        text: "Telegram 12.0 is out. Details: https://telegram.org/blog",
        views: 4_200_000,
      },
      { id: 1, date: "2026-08-20T12:00:00.000Z", text: "Stories for channels.", views: 3_900_000 },
    ],
    memberHistory: [
      { t: "2026-08-01T00:00:00.000Z", members: 9_600_000 },
      { t: "2026-08-15T00:00:00.000Z", members: 9_750_000 },
      { t: "2026-09-01T00:00:00.000Z", members: 9_870_000 },
    ],
    related: { channels: ["durov", "devnews_cn"], groups: ["example_devs"] },
  },
  {
    username: "durov",
    kind: "channel",
    category: "news",
    tags: ["english"],
    title: "Du Rove's Channel",
    description: "Thoughts from the founder of @telegram.",
    lang: "en",
    verified: true,
    avatarUrl: null,
    members: 12_480_000,
    online: null,
    activityTier: 3,
    listedAt: "2026-09-01T00:00:00.000Z",
    promo: null,
  },
  {
    username: "devnews_cn",
    kind: "channel",
    category: "tech",
    tags: ["programming", "chinese"],
    title: "开发者日报",
    description: "每天精选开发、开源和科技新闻。",
    descriptionZh: "每天精选开发、开源和科技新闻。",
    descriptionEn: "A daily pick of development, open-source and tech news.",
    lang: "zh",
    verified: false,
    avatarUrl: null,
    members: 48_210,
    online: null,
    activityTier: 4,
    listedAt: "2026-09-14T00:00:00.000Z",
    promo: null,
  },
  {
    username: "example_devs",
    kind: "group",
    category: "tech",
    tags: ["programming", "chinese"],
    title: "开发者交流群",
    description: "讨论前端、后端、DevOps 和开源项目，禁止广告，提问前请先搜索。",
    lang: "zh",
    verified: false,
    avatarUrl: null,
    members: 23_456,
    online: 812,
    activityTier: null,
    listedAt: "2026-09-10T00:00:00.000Z",
    promo: null,
  },
  {
    username: "example_chat",
    kind: "group",
    category: "chat",
    tags: ["chinese"],
    title: "闲聊茶馆",
    description: "",
    lang: "zh",
    verified: false,
    avatarUrl: null,
    members: 3_120,
    online: 45,
    activityTier: null,
    listedAt: "2026-09-08T00:00:00.000Z",
    promo: null,
  },
  {
    username: "example_tools_bot",
    kind: "bot",
    category: "tools",
    tags: ["free"],
    title: "实用工具箱",
    description: "查汇率、翻译、短链接，一个机器人搞定。",
    lang: "zh",
    verified: false,
    avatarUrl: null,
    members: 5_620,
    online: null,
    activityTier: null,
    listedAt: "2026-09-13T00:00:00.000Z",
    promo: null,
  },
];

const entries: EntryView[] = devEntries
  .map((entry) => ({
    tgCreatedAt: null,
    descriptionZh: null,
    descriptionEn: null,
    posts: [],
    memberHistory: [],
    related: { channels: [], groups: [] },
    ...entry,
    updatedAt: entry.updatedAt ?? entry.listedAt,
  }))
  .sort((a, b) => b.listedAt.localeCompare(a.listedAt));

const usernamesOf = (kind: EntryView["kind"]) =>
  entries.filter((entry) => entry.kind === kind).map((entry) => entry.username);

export const devSiteData: SiteData = {
  generatedAt: "2026-09-17T00:00:00.000Z",
  stats: {
    total: entries.length,
    channels: usernamesOf("channel").length,
    groups: usernamesOf("group").length,
    bots: usernamesOf("bot").length,
  },
  // Ids mirror the seed migration's insertion order, which is what the real database assigns.
  categories: categories.map((category, index) => ({
    ...category,
    id: index + 1,
    icon: null,
    count: entries.filter((e) => e.kind === category.kind && e.category === category.slug).length,
  })),
  tags: tags.map((tag, index) => ({
    ...tag,
    id: index + 1,
    count: entries.filter((entry) => entry.tags.includes(tag.slug)).length,
  })),
  entries,
  randomShards: {
    channel: usernamesOf("channel"),
    group: usernamesOf("group"),
    bot: usernamesOf("bot"),
    all: entries.map((entry) => entry.username),
  },
  announcement: null,
  promos: [],
  sponsoredAnnouncements: [],
  showAdSlots: true,
  friendLinks: [
    {
      name: "Telegram",
      url: "https://telegram.org/",
      descZh: "Telegram 官方网站",
      descEn: "The official Telegram website",
    },
    { name: "grammY", url: "https://grammy.dev/", descZh: "Telegram 机器人框架", descEn: "" },
    { name: "Astro", url: "https://astro.build/", descZh: "", descEn: "The web framework" },
  ],
  payments: { stars: true, usdt: true },
  products: (
    [
      ["highlight", "高亮", "Highlight", "3"],
      ["category_pin", "分类置顶", "Category pin", "5"],
      ["pin", "全站置顶", "Site-wide pin", "10"],
      ["banner", "首页横幅", "Home banner", "20"],
      ["announcement", "顶部公告条", "Top announcement bar", "30"],
    ] as const
  ).map(([kind, nameZh, nameEn, usdt], index) => ({
    id: index + 1,
    kind,
    nameZh: `${nameZh} 7 天`,
    nameEn: `${nameEn} for 7 days`,
    days: 7,
    priceStars: Number(usdt) * 80,
    priceUsdt: usdt,
  })),
  inventory: [
    { kind: "highlight", slots: 30, used: 1 },
    { kind: "category_pin", slots: 3, used: null },
    { kind: "pin", slots: 10, used: 1 },
    { kind: "banner", slots: 5, used: 0 },
    { kind: "announcement", slots: 1, used: 0 },
  ],
};
