import type { EntryKind } from "./domain.ts";

export type Category = {
  slug: string;
  kind: EntryKind;
  nameZh: string;
  nameEn: string;
  sort: number;
};

type CategoryInput = [slug: string, nameZh: string, nameEn: string];

function defineKind(kind: EntryKind, items: CategoryInput[]): Category[] {
  return items.map(([slug, nameZh, nameEn], index) => ({
    slug,
    kind,
    nameZh,
    nameEn,
    sort: (index + 1) * 10,
  }));
}

// Slugs are unique per kind (e.g. "software" exists for both channel and group).
export const categories: Category[] = [
  ...defineKind("channel", [
    ["news", "资讯新闻", "News"],
    ["video", "影音资源", "Video & Music"],
    ["software", "软件综合", "Software"],
    ["resources", "资源分享", "Resources"],
    ["learning", "知识学习", "Learning"],
    ["fun", "搞笑趣味", "Fun"],
    ["books", "书报刊漫", "Books & Comics"],
    ["blog", "博客杂谈", "Blogs"],
    ["wallpaper", "壁纸图片", "Wallpapers & Images"],
    ["tech", "开发编程", "Development"],
    ["ai", "AI", "AI"],
    ["deals", "商品优惠", "Deals"],
    ["games", "游戏", "Games"],
    ["stickers", "表情贴纸", "Stickers"],
    ["nav", "导航索引", "Directories"],
  ]),
  ...defineKind("group", [
    ["chat", "交流社群", "Chat"],
    ["software", "软件社群", "Software"],
    ["interest", "兴趣社群", "Interests"],
    ["tech", "技术开发", "Development"],
    ["vps", "主机VPS", "Hosting & VPS"],
    ["games", "游戏", "Games"],
    ["ios", "iOS社区", "iOS"],
    ["other", "其他", "Other"],
  ]),
  ...defineKind("bot", [
    ["tools", "实用工具", "Utilities"],
    ["messaging", "消息收发", "Messaging"],
    ["group-admin", "群组管理", "Group Admin"],
    ["search", "搜索", "Search"],
    ["media", "影音下载", "Media Download"],
    ["ai", "AI助手", "AI Assistants"],
  ]),
];

export function categoriesOf(kind: EntryKind): Category[] {
  return categories.filter((category) => category.kind === kind);
}

export function findCategory(kind: EntryKind, slug: string): Category | undefined {
  return categories.find((category) => category.kind === kind && category.slug === slug);
}
