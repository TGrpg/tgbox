import type { EntryKind } from "./domain.ts";

export type Tag = {
  slug: string;
  nameZh: string;
  nameEn: string;
};

/**
 * Seed tags. One **global** vocabulary: a tag is never owned by a category, because a tag page
 * only gets indexed once it has `MIN_INDEXED_LISTING_ENTRIES` entries, and on a small corpus the
 * only way it gets there is by aggregating across kinds and categories.
 *
 * D1 is the source of truth once seeded (admins add and rename rows), so this list only ever grows
 * and additions go at the end. Retired tags are removed from the live database with the admin's
 * `deleteTag`, never by a migration — dropping one here just stops new databases from seeding it.
 */
export const tags: Tag[] = [
  { slug: "free", nameZh: "免费", nameEn: "Free" },
  { slug: "open-source", nameZh: "开源", nameEn: "Open Source" },
  { slug: "android", nameZh: "安卓", nameEn: "Android" },
  { slug: "ios", nameZh: "iOS", nameEn: "iOS" },
  { slug: "windows", nameZh: "Windows", nameEn: "Windows" },
  { slug: "linux", nameZh: "Linux", nameEn: "Linux" },
  { slug: "movies", nameZh: "电影", nameEn: "Movies" },
  { slug: "tv-series", nameZh: "剧集", nameEn: "TV Series" },
  { slug: "anime", nameZh: "动漫", nameEn: "Anime" },
  { slug: "music", nameZh: "音乐", nameEn: "Music" },
  { slug: "ebooks", nameZh: "电子书", nameEn: "E-books" },
  { slug: "programming", nameZh: "编程", nameEn: "Programming" },
  { slug: "security", nameZh: "网络安全", nameEn: "Security" },
  { slug: "finance", nameZh: "财经", nameEn: "Finance" },
  { slug: "science", nameZh: "科学", nameEn: "Science" },
  { slug: "design", nameZh: "设计", nameEn: "Design" },
  { slug: "photography", nameZh: "摄影", nameEn: "Photography" },
  { slug: "sports", nameZh: "体育", nameEn: "Sports" },
  { slug: "memes", nameZh: "表情包", nameEn: "Memes" },
  { slug: "chatgpt", nameZh: "ChatGPT", nameEn: "ChatGPT" },
  { slug: "freebies", nameZh: "羊毛福利", nameEn: "Freebies" },
  { slug: "daily-news", nameZh: "每日早报", nameEn: "Daily Digest" },
  // Appended 2026-09. Tags are cross-kind, so these carry the search intent the new categories
  // only cover for one kind (a 网盘 bot and a 抽奖 group have no category of their own).
  { slug: "airdrop", nameZh: "空投", nameEn: "Airdrops" },
  { slug: "cloud-drive", nameZh: "网盘", nameEn: "Cloud Drive" },
  { slug: "torrent", nameZh: "磁力BT", nameEn: "Torrents" },
  { slug: "ai-art", nameZh: "AI绘画", nameEn: "AI Art" },
  // Taxonomy v2: AI split into the things people actually search for, plus the two topics the
  // categories cover for one kind only (a VPS channel, a 数码 group).
  { slug: "llm", nameZh: "大模型", nameEn: "LLMs" },
  { slug: "ai-coding", nameZh: "AI编程", nameEn: "AI Coding" },
  { slug: "ai-agent", nameZh: "AI智能体", nameEn: "AI Agents" },
  { slug: "ai-video", nameZh: "AI视频", nameEn: "AI Video" },
  { slug: "prompt", nameZh: "提示词", nameEn: "Prompts" },
  { slug: "free-api", nameZh: "免费API", nameEn: "Free API" },
  { slug: "short-drama", nameZh: "短剧", nameEn: "Short Drama" },
  { slug: "vps", nameZh: "主机VPS", nameEn: "Hosting & VPS" },
  { slug: "gadgets", nameZh: "数码硬件", nameEn: "Gadgets" },
  // Run by Telegram itself. An attribute, not a topic: it says who operates the entry. Appended
  // last so the bot's tag bitmask, which indexes tags in id order, keeps every old draft's meaning.
  { slug: "official", nameZh: "官方", nameEn: "Official" },
  // Appended 2026-09 with the crypto / AI import: what people search for inside those categories.
  { slug: "api-relay", nameZh: "API中转", nameEn: "API Relay" },
  { slug: "quant", nameZh: "量化交易", nameEn: "Quant Trading" },
  { slug: "exchange", nameZh: "交易所", nameEn: "Exchanges" },
  { slug: "on-chain", nameZh: "链上数据", nameEn: "On-chain Data" },
  { slug: "ton", nameZh: "TON生态", nameEn: "TON" },
  { slug: "solana", nameZh: "Solana", nameEn: "Solana" },
];

export function findTag(slug: string): Tag | undefined {
  return tags.find((tag) => tag.slug === slug);
}

/**
 * What a tag says about an entry: what it is *about* (主题) or what it *is* (属性). No schema
 * change — this only groups the chips in the pickers.
 */
export type TagFacet = "topic" | "attribute";

/** The tags that describe the entry itself rather than its subject. */
const attributeTags: readonly string[] = [
  "free",
  "open-source",
  "android",
  "ios",
  "windows",
  "linux",
  "official",
];

export const tagFacets: Record<string, TagFacet> = Object.fromEntries(
  tags.map((tag) => [tag.slug, attributeTags.includes(tag.slug) ? "attribute" : "topic"]),
);

/** A tag an admin added after the seed has no facet of its own; it is about something. */
export function tagFacet(slug: string): TagFacet {
  return tagFacets[slug] ?? "topic";
}

/**
 * Which tags a category usually wants, in display order. Hints only: the vocabulary stays global
 * and the rest of it is always one tap away, so a hint is never a constraint on what can be
 * tagged. A category with no entry here (`group:other`, anything an admin adds) simply shows the
 * full list.
 */
export const categoryTagHints: Record<`${EntryKind}:${string}`, readonly string[]> = {
  "channel:news": ["daily-news", "finance", "science", "gadgets", "security", "sports"],
  "channel:video": [
    "movies",
    "tv-series",
    "short-drama",
    "anime",
    "music",
    "torrent",
    "cloud-drive",
  ],
  "channel:software": ["android", "ios", "windows", "linux", "free", "open-source", "cloud-drive"],
  "channel:resources": ["cloud-drive", "torrent", "ebooks", "music", "movies", "design", "free"],
  "channel:learning": ["ebooks", "programming", "science", "finance", "design", "prompt"],
  "channel:fun": ["memes", "short-drama", "anime", "sports"],
  "channel:books": ["ebooks", "anime", "cloud-drive", "free"],
  "channel:blog": ["programming", "science", "finance", "design", "photography"],
  "channel:wallpaper": ["photography", "design", "anime", "ai-art"],
  "channel:tech": [
    "programming",
    "open-source",
    "security",
    "vps",
    "linux",
    "gadgets",
    "ai-coding",
  ],
  "channel:ai": [
    "llm",
    "chatgpt",
    "ai-art",
    "ai-video",
    "ai-coding",
    "ai-agent",
    "prompt",
    "free-api",
    "api-relay",
    "open-source",
    "free",
  ],
  "channel:deals": ["freebies", "gadgets", "finance", "free"],
  "channel:games": ["android", "ios", "windows", "torrent", "free", "memes"],
  "channel:stickers": ["memes", "anime", "design", "ai-art"],
  "channel:nav": ["cloud-drive", "torrent", "movies", "ebooks", "free"],
  "channel:giveaway": ["freebies", "airdrop", "gadgets", "free"],
  "channel:crypto": [
    "exchange",
    "on-chain",
    "quant",
    "airdrop",
    "ton",
    "solana",
    "finance",
    "security",
  ],
  "channel:vpn": ["free", "open-source", "android", "ios", "windows"],
  "channel:cloud-drive": [
    "movies",
    "tv-series",
    "short-drama",
    "anime",
    "ebooks",
    "music",
    "torrent",
  ],
  "channel:jobs": ["programming", "design", "finance", "free"],
  "channel:life": ["photography", "sports", "finance", "science"],

  "group:chat": ["memes", "sports", "music", "science", "finance"],
  "group:software": ["android", "ios", "windows", "linux", "free", "open-source", "cloud-drive"],
  "group:interest": ["music", "photography", "anime", "sports", "design", "science"],
  "group:tech": ["programming", "open-source", "security", "vps", "linux", "ai-coding", "llm"],
  "group:vps": ["linux", "security", "open-source", "free", "programming"],
  "group:games": ["android", "ios", "windows", "free", "memes"],
  "group:ios": ["ios", "free", "torrent", "cloud-drive", "design"],
  // "group:other" is deliberately absent: the bucket for everything else hints at nothing.
  "group:crypto": [
    "exchange",
    "on-chain",
    "quant",
    "airdrop",
    "ton",
    "solana",
    "finance",
    "security",
  ],
  "group:vpn": ["free", "open-source", "android", "ios", "windows"],
  "group:learning": ["ebooks", "programming", "science", "design", "prompt"],
  "group:trade": ["finance", "freebies", "gadgets", "airdrop"],
  "group:jobs": ["programming", "design", "finance"],
  "group:local": ["finance", "sports", "photography"],
  "group:video": ["movies", "tv-series", "short-drama", "anime", "music", "torrent", "cloud-drive"],
  "group:ai": [
    "llm",
    "chatgpt",
    "api-relay",
    "ai-coding",
    "ai-agent",
    "ai-art",
    "prompt",
    "free-api",
    "open-source",
  ],

  "bot:tools": [
    "free",
    "open-source",
    "cloud-drive",
    "torrent",
    "design",
    "llm",
    "prompt",
    "security",
  ],
  "bot:messaging": ["free", "open-source", "memes"],
  "bot:group-admin": ["free", "open-source", "security", "llm"],
  "bot:search": [
    "movies",
    "tv-series",
    "anime",
    "ebooks",
    "music",
    "cloud-drive",
    "torrent",
    "free",
  ],
  "bot:media": [
    "movies",
    "tv-series",
    "short-drama",
    "anime",
    "music",
    "torrent",
    "cloud-drive",
    "free",
  ],
  "bot:ai": [
    "llm",
    "chatgpt",
    "ai-art",
    "ai-video",
    "ai-agent",
    "prompt",
    "free-api",
    "free",
    "open-source",
  ],
  "bot:giveaway": ["freebies", "airdrop", "free"],
  "bot:files": ["cloud-drive", "torrent", "ebooks", "free"],
  "bot:stickers": ["memes", "anime", "ai-art", "design"],
  "bot:crypto": ["ton", "solana", "on-chain", "exchange", "airdrop", "finance", "security", "free"],
  "bot:productivity": ["free", "open-source", "finance", "programming"],
  "bot:rss": ["free", "open-source", "daily-news", "programming"],
  "bot:channel-tools": ["free", "finance", "open-source"],
  "bot:translate": ["free", "llm", "open-source"],
  "bot:games": ["memes", "anime", "free"],
  "bot:analytics": ["finance", "free", "open-source"],
  "bot:trading": ["quant", "solana", "ton", "on-chain", "exchange", "airdrop"],
};

/**
 * Splits the **live** tag list (D1 rows, not these constants) into the ones the category hints at
 * and everything else. Both pickers call this: the bot pages over the result and the web reveals
 * `rest` behind 「显示全部」.
 *
 * The intersection is what makes it safe to edit taxonomy in the admin: a tag an admin added lands
 * in `rest`, and a hint naming a tag that was retired is skipped instead of inventing a chip.
 */
export function tagsForCategory<T extends { slug: string }>(
  kind: EntryKind,
  categorySlug: string | null,
  liveTags: readonly T[],
): { hinted: T[]; rest: T[] } {
  const hints = categorySlug === null ? undefined : categoryTagHints[`${kind}:${categorySlug}`];
  if (!hints) return { hinted: [], rest: [...liveTags] };
  const bySlug = new Map(liveTags.map((tag) => [tag.slug, tag]));
  const hinted = hints.flatMap((slug) => {
    const tag = bySlug.get(slug);
    return tag ? [tag] : [];
  });
  const picked = new Set(hinted);
  return { hinted, rest: liveTags.filter((tag) => !picked.has(tag)) };
}
