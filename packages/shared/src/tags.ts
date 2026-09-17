export type Tag = {
  slug: string;
  nameZh: string;
  nameEn: string;
};

export const tags: Tag[] = [
  { slug: "chinese", nameZh: "中文", nameEn: "Chinese" },
  { slug: "english", nameZh: "英文", nameEn: "English" },
  { slug: "free", nameZh: "免费", nameEn: "Free" },
  { slug: "open-source", nameZh: "开源", nameEn: "Open Source" },
  { slug: "android", nameZh: "安卓", nameEn: "Android" },
  { slug: "ios", nameZh: "iOS", nameEn: "iOS" },
  { slug: "windows", nameZh: "Windows", nameEn: "Windows" },
  { slug: "macos", nameZh: "macOS", nameEn: "macOS" },
  { slug: "linux", nameZh: "Linux", nameEn: "Linux" },
  { slug: "movies", nameZh: "电影", nameEn: "Movies" },
  { slug: "tv-series", nameZh: "剧集", nameEn: "TV Series" },
  { slug: "anime", nameZh: "动漫", nameEn: "Anime" },
  { slug: "music", nameZh: "音乐", nameEn: "Music" },
  { slug: "ebooks", nameZh: "电子书", nameEn: "E-books" },
  { slug: "podcast", nameZh: "播客", nameEn: "Podcasts" },
  { slug: "programming", nameZh: "编程", nameEn: "Programming" },
  { slug: "security", nameZh: "网络安全", nameEn: "Security" },
  { slug: "crypto", nameZh: "加密货币", nameEn: "Crypto" },
  { slug: "finance", nameZh: "财经", nameEn: "Finance" },
  { slug: "science", nameZh: "科学", nameEn: "Science" },
  { slug: "design", nameZh: "设计", nameEn: "Design" },
  { slug: "photography", nameZh: "摄影", nameEn: "Photography" },
  { slug: "travel", nameZh: "旅行", nameEn: "Travel" },
  { slug: "food", nameZh: "美食", nameEn: "Food" },
  { slug: "sports", nameZh: "体育", nameEn: "Sports" },
  { slug: "memes", nameZh: "表情包", nameEn: "Memes" },
  { slug: "chatgpt", nameZh: "ChatGPT", nameEn: "ChatGPT" },
  { slug: "vpn", nameZh: "科学上网", nameEn: "VPN & Proxy" },
  { slug: "freebies", nameZh: "羊毛福利", nameEn: "Freebies" },
  { slug: "daily-news", nameZh: "每日早报", nameEn: "Daily Digest" },
];

export function findTag(slug: string): Tag | undefined {
  return tags.find((tag) => tag.slug === slug);
}
