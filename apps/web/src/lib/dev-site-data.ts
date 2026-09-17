import { categories, type EntryView, type SiteData, tags } from "@tgbox/shared";

type DevEntry = Omit<EntryView, "posts" | "memberHistory" | "related" | "tgCreatedAt"> &
  Partial<Pick<EntryView, "posts" | "memberHistory" | "related" | "tgCreatedAt">>;

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
    isPromoted: true,
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
    isPromoted: false,
  },
  {
    username: "devnews_cn",
    kind: "channel",
    category: "tech",
    tags: ["programming", "chinese"],
    title: "开发者日报",
    description: "每天精选开发、开源和科技新闻。",
    lang: "zh",
    verified: false,
    avatarUrl: null,
    members: 48_210,
    online: null,
    activityTier: 4,
    listedAt: "2026-09-14T00:00:00.000Z",
    isPromoted: false,
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
    isPromoted: false,
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
    isPromoted: false,
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
    isPromoted: false,
  },
];

const entries: EntryView[] = devEntries
  .map((entry) => ({
    tgCreatedAt: null,
    posts: [],
    memberHistory: [],
    related: { channels: [], groups: [] },
    ...entry,
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
  categories: categories.map((category) => ({
    ...category,
    icon: null,
    count: entries.filter((e) => e.kind === category.kind && e.category === category.slug).length,
  })),
  tags: tags.map((tag) => ({
    ...tag,
    count: entries.filter((entry) => entry.tags.includes(tag.slug)).length,
  })),
  entries,
  randomShards: {
    channel: usernamesOf("channel"),
    group: usernamesOf("group"),
    bot: usernamesOf("bot"),
    all: entries.map((entry) => entry.username),
  },
};
