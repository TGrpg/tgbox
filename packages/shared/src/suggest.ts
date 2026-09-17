import { z } from "zod";
import type { EntryKind } from "./domain.ts";
import { MAX_TAGS } from "./domain.ts";

/**
 * Proposes a category and tags from what t.me says about an entry, so the submitter confirms
 * instead of guessing. Both the bot and the Mini App call `suggestTaxonomy`; neither has rules of
 * its own.
 *
 * Two passes. A keyword pass over title + description costs nothing and settles the obvious cases
 * (抽奖 → 抽奖福利, VPS → 主机VPS). Only when it is unsure does the optional `classify` hook run —
 * one Workers AI call, see `aiCategoryClassifier` in @tgbox/core.
 *
 * It suggests, it never decides: everything it returns is pre-selected in a picker the submitter
 * and the reviewer can change. A wrong silent assignment is worse than no suggestion, so anything
 * uncertain, failed or outside the live taxonomy comes back as `null`.
 */

/** The live taxonomy from D1 — never the seed constants, because admins add and rename rows. */
export type SuggestTaxonomy = {
  categories: readonly { id: number; kind: EntryKind; slug: string; nameZh: string }[];
  tags: readonly { id: number; slug: string }[];
};

export type SuggestInput = { kind: EntryKind; title: string; description: string };

/** Where the category came from; `none` means nothing was confident enough to propose. */
export const SuggestSource = z.enum(["rules", "ai", "none"]);
export type SuggestSource = z.infer<typeof SuggestSource>;

/** Also travels to the Mini App inside `AppPreview`, hence the schema. */
export const Suggestion = z.object({
  categoryId: z.number().int().nullable(),
  tagIds: z.array(z.number().int()),
  source: SuggestSource,
});
export type Suggestion = z.infer<typeof Suggestion>;

/** What the AI pass is asked, and the only answers it may give. */
export type ClassifyRequest = SuggestInput & {
  candidates: readonly { slug: string; nameZh: string }[];
};

/** Returns one candidate slug, or null when it fails or answers something unusable. */
export type CategoryClassifier = (request: ClassifyRequest) => Promise<string | null>;

/* ------------------------------------------------------------------- matching */

const HAN = /\p{Script=Han}/u;

/** A term the rules look for. ASCII terms need word boundaries; CJK terms have none to need. */
type Term = { source: string; test: (text: string) => boolean };

function term(source: string): Term {
  const value = source.toLowerCase();
  if (!/^[a-z0-9 +.#-]+$/.test(value)) {
    return { source, test: (text) => text.includes(value) };
  }
  // "ai" must not fire inside "said", and "vps" should still match "vps/独服".
  const escaped = value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
  return { source, test: (text) => pattern.test(text) };
}

/** A title mention is a deliberate self-description; a description mention is weaker evidence. */
const TITLE_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;

function score(terms: readonly Term[], title: string, description: string) {
  let total = 0;
  for (const item of terms) {
    if (item.test(title)) total += TITLE_WEIGHT;
    if (item.test(description)) total += DESCRIPTION_WEIGHT;
  }
  return total;
}

/* ---------------------------------------------------------------------- rules */

type CategoryRule = {
  /** Category slug per kind; a kind that is absent means the rule says nothing about it. */
  category: Partial<Record<EntryKind, string>>;
  terms: readonly Term[];
};

const rule = (
  category: Partial<Record<EntryKind, string>>,
  terms: readonly string[],
): CategoryRule => ({ category, terms: terms.map(term) });

/**
 * Keyword → category. Terms are matched against the lowercased title and description, so the
 * English and Chinese names of one thing sit in a single rule. Ties keep table order, so the
 * narrow rules come first.
 *
 * There is deliberately **no rule for 资源分享 / 交流社群-style catch-alls**: those are where
 * everything ends up when a submitter can't decide, and routing to them automatically is the
 * failure this whole module exists to fix. If nothing specific matches, the AI pass gets a say and
 * otherwise the submitter is asked, which is the honest answer.
 */
const categoryRules: readonly CategoryRule[] = [
  rule({ channel: "giveaway", bot: "giveaway" }, [
    "抽奖",
    "抽獎",
    "giveaway",
    "lottery",
    "送码",
    "白嫖",
    "薅羊毛",
    "羊毛",
    "福利",
  ]),
  rule({ channel: "wallpaper" }, ["壁纸", "桌布", "wallpaper", "4k", "高清图"]),
  rule({ channel: "stickers", bot: "stickers" }, ["表情包", "贴纸", "貼紙", "sticker", "emoji"]),
  rule({ group: "vps" }, ["vps", "主机", "服务器", "独服", "建站", "vultr", "hosting"]),
  rule({ channel: "vpn", group: "vpn" }, [
    "科学上网",
    "翻墙",
    "机场",
    "节点",
    "clash",
    "v2ray",
    "shadowsocks",
    "vpn",
    "proxy",
    "订阅",
  ]),
  rule({ channel: "crypto", group: "crypto", bot: "crypto" }, [
    "加密货币",
    "虚拟货币",
    "区块链",
    "币圈",
    "crypto",
    "bitcoin",
    "比特币",
    "以太坊",
    "web3",
    "空投",
    "airdrop",
    "defi",
    "nft",
    "usdt",
    "交易所",
    "钱包",
  ]),
  rule({ channel: "cloud-drive" }, [
    "网盘",
    "云盘",
    "夸克",
    "阿里云盘",
    "百度网盘",
    "天翼",
    "onedrive",
    "磁力",
    "种子",
  ]),
  rule({ channel: "ai", bot: "ai" }, [
    "ai",
    "人工智能",
    "chatgpt",
    "gpt",
    "midjourney",
    "stable diffusion",
    "大模型",
    "llm",
    "aigc",
    "claude",
  ]),
  rule({ channel: "jobs", group: "jobs" }, [
    "招聘",
    "求职",
    "兼职",
    "找工作",
    "job",
    "jobs",
    "hiring",
    "recruit",
    "远程工作",
    "内推",
  ]),
  rule({ group: "local" }, ["同城", "本地", "华人", "留学", "移民", "签证", "local"]),
  rule({ group: "trade" }, [
    "二手",
    "出售",
    "收购",
    "闲置",
    "跳蚤",
    "marketplace",
    "买卖",
    "转让",
    "卡号",
  ]),
  rule({ channel: "deals" }, [
    "优惠",
    "折扣",
    "好价",
    "特价",
    "促销",
    "deal",
    "deals",
    "discount",
    "coupon",
    "优惠券",
    "省钱",
  ]),
  rule({ bot: "analytics" }, ["数据分析", "统计", "频道分析", "analytics", "stats"]),
  rule({ bot: "files" }, ["文件", "存储", "上传", "转存", "file", "storage", "云存储"]),
  rule({ bot: "media" }, [
    "下载",
    "download",
    "downloader",
    "解析",
    "youtube",
    "tiktok",
    "视频下载",
  ]),
  rule({ bot: "search" }, ["搜索", "查询", "搜群", "search", "find"]),
  rule({ bot: "group-admin" }, [
    "群管",
    "反垃圾",
    "验证",
    "封禁",
    "admin",
    "moderation",
    "captcha",
    "群组管理",
  ]),
  rule({ bot: "messaging" }, ["转发", "私聊", "留言", "客服", "匿名", "forward", "message"]),
  rule({ channel: "games", group: "games", bot: "games" }, [
    "游戏",
    "手游",
    "端游",
    "steam",
    "game",
    "games",
    "gaming",
    "原神",
    "switch",
  ]),
  rule({ channel: "video", group: "video" }, [
    "电影",
    "影视",
    "剧集",
    "美剧",
    "韩剧",
    "动漫",
    "追剧",
    "短剧",
    "movie",
    "movies",
    "anime",
    "音乐",
    "music",
  ]),
  rule({ channel: "books" }, [
    "电子书",
    "小说",
    "漫画",
    "杂志",
    "书籍",
    "有声书",
    "book",
    "books",
    "ebook",
    "epub",
    "comic",
  ]),
  rule({ channel: "tech", group: "tech" }, [
    "编程",
    "开发",
    "程序员",
    "代码",
    "programming",
    "developer",
    "github",
    "python",
    "javascript",
    "前端",
    "后端",
  ]),
  rule({ channel: "learning", group: "learning" }, [
    "学习",
    "教程",
    "考研",
    "考试",
    "课程",
    "知识",
    "英语",
    "教育",
    "learning",
    "course",
    "tutorial",
    "study",
  ]),
  rule({ channel: "software", group: "software" }, [
    "软件",
    "应用",
    "破解",
    "安卓",
    "apk",
    "app",
    "software",
    "windows",
    "macos",
    "插件",
    "工具箱",
  ]),
  rule({ channel: "life" }, [
    "美食",
    "旅行",
    "健身",
    "养生",
    "穿搭",
    "生活",
    "宠物",
    "育儿",
    "情感",
    "travel",
    "food",
    "fitness",
  ]),
  rule({ channel: "news" }, ["新闻", "资讯", "早报", "快讯", "时事", "头条", "news", "daily"]),
  rule({ channel: "nav" }, ["导航", "索引", "目录", "大全", "合集", "directory", "index"]),
  rule({ channel: "fun" }, ["搞笑", "趣味", "沙雕", "段子", "幽默", "笑话", "meme", "funny"]),
  rule({ channel: "blog" }, ["博客", "随笔", "杂谈", "blog", "个人频道"]),
  rule({ bot: "tools" }, ["工具", "实用", "转换", "翻译", "tool", "tools", "utility"]),
  rule({ group: "chat" }, ["交流", "聊天", "水群", "闲聊", "chat", "discussion"]),
  rule({ group: "ios" }, ["ios", "iphone", "ipad", "苹果", "越狱", "testflight"]),
  rule({ group: "interest" }, ["兴趣", "爱好", "同好"]),
];

type TagRule = { slug: string; terms: readonly Term[] };
const tagRule = (slug: string, terms: readonly string[]): TagRule => ({
  slug,
  terms: terms.map(term),
});

/** Keyword → tag. Tags are cross-kind, so these ignore `kind` entirely. */
const tagRules: readonly TagRule[] = [
  tagRule("giveaway", ["抽奖", "抽獎", "giveaway", "lottery", "送码"]),
  tagRule("freebies", ["羊毛", "福利", "白嫖", "免费领", "freebies"]),
  tagRule("airdrop", ["空投", "airdrop", "撸毛"]),
  tagRule("crypto", ["加密货币", "比特币", "crypto", "bitcoin", "web3", "usdt", "币圈"]),
  tagRule("cloud-drive", ["网盘", "云盘", "夸克", "阿里云盘", "百度网盘", "onedrive"]),
  tagRule("torrent", ["磁力", "种子", "torrent", "magnet", "bt"]),
  tagRule("vpn", ["科学上网", "翻墙", "机场", "节点", "clash", "v2ray", "vpn", "proxy"]),
  tagRule("movies", ["电影", "movie", "movies", "影视"]),
  tagRule("tv-series", ["剧集", "美剧", "韩剧", "日剧", "追剧", "短剧", "tv series"]),
  tagRule("anime", ["动漫", "番剧", "anime", "動漫", "二次元"]),
  tagRule("music", ["音乐", "无损", "music", "flac", "歌曲"]),
  tagRule("ebooks", ["电子书", "epub", "ebook", "mobi", "书籍"]),
  tagRule("podcast", ["播客", "podcast", "电台"]),
  tagRule("tutorial", ["教程", "tutorial", "guide", "入门", "指南"]),
  tagRule("programming", ["编程", "代码", "programming", "developer", "python", "javascript"]),
  tagRule("security", ["网络安全", "渗透", "security", "hacking", "漏洞"]),
  tagRule("aigc", ["ai绘画", "绘画", "aigc", "midjourney", "stable diffusion", "文生图"]),
  tagRule("chatgpt", ["chatgpt", "gpt", "openai"]),
  tagRule("finance", ["财经", "股票", "基金", "理财", "finance", "stock"]),
  tagRule("science", ["科学", "科普", "science", "研究"]),
  tagRule("design", ["设计", "素材", "design", "字体", "ui"]),
  tagRule("photography", ["摄影", "photography", "写真", "相机"]),
  tagRule("travel", ["旅行", "旅游", "travel", "机票", "签证"]),
  tagRule("food", ["美食", "菜谱", "food", "recipe", "探店"]),
  tagRule("pets", ["宠物", "萌宠", "撸猫", "pets", "喵星人"]),
  tagRule("sports", ["体育", "足球", "篮球", "sports", "nba", "赛事"]),
  tagRule("memes", ["表情包", "沙雕", "meme", "memes", "梗图"]),
  // "每日" and a bare "daily" are not this tag: 每日壁纸 and "updated daily" are about cadence,
  // not a news briefing. Only the words that name the format itself.
  tagRule("daily-news", ["早报", "日报", "每日早报", "每日新闻", "daily news", "daily digest"]),
  tagRule("open-source", ["开源", "open source", "github", "opensource"]),
  tagRule("free", ["免费", "free"]),
  tagRule("android", ["安卓", "android", "apk"]),
  tagRule("ios", ["ios", "iphone", "ipad", "越狱", "testflight"]),
  tagRule("windows", ["windows", "win11", "win10"]),
  tagRule("macos", ["macos", "mac os", "苹果电脑"]),
  tagRule("linux", ["linux", "ubuntu", "debian"]),
];

/* ----------------------------------------------------------------- confidence */

/**
 * A title hit (3) or two description hits (2) is enough to propose a category; a single passing
 * mention (1) is not. The leader also has to be ahead of the runner-up, or the text is about two
 * things at once and the AI pass gets a say.
 */
const MIN_CATEGORY_SCORE = 2;
const MIN_CATEGORY_MARGIN = 1;
/** Same bar for a tag, minus the margin: tags don't compete with each other. */
const MIN_TAG_SCORE = 2;

type Scored = { slug: string; score: number };

function rankCategories(input: SuggestInput, allowed: ReadonlySet<string>): Scored[] {
  const title = input.title.toLowerCase();
  const description = input.description.toLowerCase();
  const scores = new Map<string, number>();
  for (const item of categoryRules) {
    const slug = item.category[input.kind];
    if (slug === undefined || !allowed.has(slug)) continue;
    const value = score(item.terms, title, description);
    if (value === 0) continue;
    scores.set(slug, Math.max(scores.get(slug) ?? 0, value));
  }
  return [...scores]
    .map(([slug, value]) => ({ slug, score: value }))
    .sort((a, b) => b.score - a.score);
}

function rankTags(input: SuggestInput, allowed: ReadonlySet<string>): Scored[] {
  const title = input.title.toLowerCase();
  const description = input.description.toLowerCase();
  return tagRules
    .filter((item) => allowed.has(item.slug))
    .map((item) => ({ slug: item.slug, score: score(item.terms, title, description) }))
    .filter((item) => item.score >= MIN_TAG_SCORE)
    .sort((a, b) => b.score - a.score);
}

/** Han anywhere in the text means Chinese; the language tag is the one guess that is nearly free. */
function languageTag(input: SuggestInput, allowed: ReadonlySet<string>): string | null {
  const chinese = HAN.test(input.title) || HAN.test(input.description);
  const slug = chinese ? "chinese" : "english";
  return allowed.has(slug) ? slug : null;
}

/* ------------------------------------------------------------------ the entry */

const EMPTY: Suggestion = { categoryId: null, tagIds: [], source: "none" };

/**
 * Pure given `(input, taxonomy)`; the optional `classify` hook is the only thing that can reach the
 * network, and it only runs when the keyword pass is unsure. Every slug it produces is checked
 * against `taxonomy` before it becomes an id, so a suggestion can never point outside the live
 * taxonomy.
 */
export async function suggestTaxonomy(
  input: SuggestInput,
  taxonomy: SuggestTaxonomy,
  options: { classify?: CategoryClassifier } = {},
): Promise<Suggestion> {
  const categories = taxonomy.categories.filter((category) => category.kind === input.kind);
  const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));
  const tagIdBySlug = new Map(taxonomy.tags.map((tag) => [tag.slug, tag.id]));
  if (categories.length === 0) return EMPTY;

  const text = {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description.trim(),
  };
  if (!text.title && !text.description) return EMPTY;

  const tagSlugs = new Set<string>();
  const language = languageTag(text, new Set(tagIdBySlug.keys()));
  if (language) tagSlugs.add(language);
  for (const tag of rankTags(text, new Set(tagIdBySlug.keys()))) {
    if (tagSlugs.size >= MAX_TAGS) break;
    tagSlugs.add(tag.slug);
  }
  const tagIds = [...tagSlugs].flatMap((slug) => {
    const id = tagIdBySlug.get(slug);
    return id === undefined ? [] : [id];
  });

  const ranked = rankCategories(text, new Set(categoryIds.keys()));
  const [best, runnerUp] = ranked;
  const confident =
    best !== undefined &&
    best.score >= MIN_CATEGORY_SCORE &&
    best.score - (runnerUp?.score ?? 0) >= MIN_CATEGORY_MARGIN;
  if (confident) {
    const id = categoryIds.get(best.slug);
    if (id !== undefined) return { categoryId: id, tagIds, source: "rules" };
  }

  if (!options.classify) return { categoryId: null, tagIds, source: "none" };
  const answer = await options.classify({
    ...text,
    candidates: categories.map((category) => ({
      slug: category.slug,
      nameZh: category.nameZh,
    })),
  });
  const id = answer === null ? undefined : categoryIds.get(answer);
  if (id === undefined) return { categoryId: null, tagIds, source: "none" };
  return { categoryId: id, tagIds, source: "ai" };
}
