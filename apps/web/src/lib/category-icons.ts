import { type CategoryIcon, categoryIcons } from "@tgbox/shared";

/**
 * Fallback icon per category slug, for categories whose `icon` is unset in D1
 * (slugs repeat across kinds on purpose: "tech" means the same everywhere).
 */
const bySlug: Record<string, CategoryIcon> = {
  news: "news",
  video: "movie",
  software: "apps",
  resources: "share",
  learning: "school",
  fun: "mood-happy",
  books: "book",
  blog: "article",
  wallpaper: "photo",
  tech: "code",
  ai: "sparkles",
  deals: "discount",
  games: "device-gamepad-2",
  stickers: "sticker",
  nav: "compass",
  chat: "message-circle",
  interest: "heart",
  vps: "server",
  ios: "brand-apple",
  other: "dots",
  tools: "tool",
  messaging: "send",
  "group-admin": "shield",
  search: "search",
  media: "download",
  giveaway: "gift",
  crypto: "coin",
  vpn: "world",
  "cloud-drive": "cloud",
  jobs: "briefcase",
  life: "coffee",
  trade: "building-store",
  local: "map-pin",
  files: "folder",
  analytics: "chart-line",
  productivity: "briefcase",
  rss: "article",
  "channel-tools": "message-circle",
  translate: "world",
};

const isIcon = (key: string | null | undefined): key is CategoryIcon =>
  categoryIcons.some((icon) => icon === key);

/** The category's own icon from site data when valid, else the slug fallback, else generic. */
export function categoryIcon(category: { slug: string; icon?: string | null }): CategoryIcon {
  if (isIcon(category.icon)) return category.icon;
  return bySlug[category.slug] ?? "category";
}
