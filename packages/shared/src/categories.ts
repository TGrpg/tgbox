import type { CategoryIcon, EntryKind } from "./domain.ts";

export type Category = {
  slug: string;
  kind: EntryKind;
  nameZh: string;
  nameEn: string;
  sort: number;
  icon: CategoryIcon;
};

type CategoryInput = [slug: string, nameZh: string, nameEn: string, icon: CategoryIcon];

function defineKind(kind: EntryKind, items: CategoryInput[]): Category[] {
  return items.map(([slug, nameZh, nameEn, icon], index) => ({
    slug,
    kind,
    nameZh,
    nameEn,
    sort: (index + 1) * 10,
    icon,
  }));
}

/**
 * Seed taxonomy. **D1 is the source of truth once seeded** — admins rename, reorder and re-icon
 * categories in the admin app — so this list only ever grows, and new entries are *appended* per
 * kind: giving an existing slug a new `sort` here would silently disagree with the live database.
 *
 * Every addition is a page that has to earn its place (`MIN_INDEXED_LISTING_ENTRIES` noindexes a
 * listing under 3 entries), so the buckets below are the ones comparable directories actually fill.
 */
// Slugs are unique per kind (e.g. "software" exists for both channel and group).
export const categories: Category[] = [
  ...defineKind("channel", [
    ["news", "资讯新闻", "News", "news"],
    ["video", "影音资源", "Video & Music", "movie"],
    ["software", "软件综合", "Software", "apps"],
    ["resources", "资源分享", "Resources", "share"],
    ["learning", "知识学习", "Learning", "school"],
    ["fun", "搞笑趣味", "Fun", "mood-happy"],
    ["books", "书报刊漫", "Books & Comics", "book"],
    ["blog", "博客杂谈", "Blogs", "article"],
    ["wallpaper", "壁纸图片", "Wallpapers & Images", "photo"],
    ["tech", "开发编程", "Development", "code"],
    ["ai", "AI", "AI", "sparkles"],
    ["deals", "商品优惠", "Deals", "discount"],
    ["games", "游戏", "Games", "device-gamepad-2"],
    ["stickers", "表情贴纸", "Stickers", "sticker"],
    ["nav", "导航索引", "Directories", "compass"],
    // Appended 2026-09: the buckets submitters had nowhere to put.
    ["giveaway", "抽奖福利", "Giveaways & Freebies", "gift"],
    ["crypto", "加密货币", "Crypto & Web3", "coin"],
    ["vpn", "科学上网", "VPN & Proxy", "world"],
    ["cloud-drive", "网盘资源", "Cloud Drives", "cloud"],
    ["jobs", "招聘求职", "Jobs & Careers", "briefcase"],
    ["life", "生活日常", "Life & Living", "coffee"],
  ]),
  ...defineKind("group", [
    ["chat", "交流社群", "Chat", "message-circle"],
    ["software", "软件社群", "Software", "apps"],
    ["interest", "兴趣社群", "Interests", "heart"],
    ["tech", "技术开发", "Development", "code"],
    ["vps", "主机VPS", "Hosting & VPS", "server"],
    ["games", "游戏", "Games", "device-gamepad-2"],
    ["ios", "iOS社区", "iOS", "brand-apple"],
    ["other", "其他", "Other", "dots"],
    // Appended 2026-09. Groups were the thinnest kind by far; these are the ones directories that
    // do give groups their own taxonomy actually fill (local, jobs, trade, learning, crypto).
    ["crypto", "加密货币", "Crypto & Web3", "coin"],
    ["vpn", "科学上网", "VPN & Proxy", "world"],
    ["learning", "学习考试", "Learning & Exams", "school"],
    ["trade", "交易市场", "Trading & Marketplace", "building-store"],
    ["jobs", "招聘求职", "Jobs & Careers", "briefcase"],
    ["local", "同城地区", "Local & Regional", "map-pin"],
    ["video", "影音资源", "Video & Music", "movie"],
  ]),
  ...defineKind("bot", [
    ["tools", "实用工具", "Utilities", "tool"],
    ["messaging", "消息收发", "Messaging", "send"],
    ["group-admin", "群组管理", "Group Admin", "shield"],
    ["search", "搜索", "Search", "search"],
    ["media", "影音下载", "Media Download", "download"],
    ["ai", "AI助手", "AI Assistants", "sparkles"],
    // Appended 2026-09. A bot taxonomy is functional, not topical: these are the jobs bots do.
    ["giveaway", "抽奖机器人", "Giveaways", "gift"],
    ["files", "文件网盘", "Files & Storage", "folder"],
    ["stickers", "表情贴纸", "Stickers & Emoji", "sticker"],
    ["crypto", "加密钱包", "Crypto & Wallets", "coin"],
    ["games", "游戏娱乐", "Games & Fun", "device-gamepad-2"],
    ["analytics", "数据分析", "Analytics", "chart-line"],
    // Appended 2026-09 with the bot directory import: each of these held 7–17 bots that would
    // otherwise have been piled into `tools`, which is where a directory stops being browsable.
    ["productivity", "效率提醒", "Productivity", "briefcase"],
    ["rss", "订阅推送", "RSS & Feeds", "article"],
    ["channel-tools", "频道运营", "Channel Tools", "message-circle"],
    ["translate", "翻译", "Translation", "world"],
  ]),
];

export function categoriesOf(kind: EntryKind): Category[] {
  return categories.filter((category) => category.kind === kind);
}

export function findCategory(kind: EntryKind, slug: string): Category | undefined {
  return categories.find((category) => category.kind === kind && category.slug === slug);
}
