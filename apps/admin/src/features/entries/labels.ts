import type { EntryKind, EntryStatus, Liveness } from "@tgbox/shared";
import type { BadgeProps } from "@/components/coss/ui/badge.tsx";

export const kindLabel: Record<EntryKind, string> = {
  channel: "频道",
  group: "群组",
  bot: "机器人",
};

export const statusLabel: Record<EntryStatus, string> = {
  approved: "已上线",
  hidden_by_system: "系统隐藏",
  hidden_by_admin: "管理员隐藏",
  removed: "已删除",
};

export const statusVariant: Record<EntryStatus, NonNullable<BadgeProps["variant"]>> = {
  approved: "success",
  hidden_by_system: "warning",
  hidden_by_admin: "secondary",
  removed: "error",
};

export const livenessLabel: Record<Liveness, string> = {
  active: "正常",
  not_found: "不存在",
  banned: "已封禁",
  type_changed: "类型变更",
  unknown: "未知",
};

export const livenessVariant: Record<Liveness, NonNullable<BadgeProps["variant"]>> = {
  active: "success",
  not_found: "error",
  banned: "error",
  type_changed: "warning",
  unknown: "outline",
};

export const activityLabel = (tier: number | null) =>
  tier === null ? "—" : (["沉寂", "偶尔", "一般", "活跃", "很活跃"][tier] ?? "—");

export const langLabel: Record<string, string> = {
  zh: "中文",
  en: "英语",
  ru: "俄语",
  ja: "日语",
  ko: "韩语",
  fa: "波斯语",
  ar: "阿拉伯语",
  es: "西班牙语",
  fr: "法语",
  de: "德语",
  uz: "乌兹别克语",
};

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
export const formatCount = (value: number | null) => (value === null ? "—" : compact.format(value));

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("zh-CN", { year: "2-digit", month: "2-digit", day: "2-digit" });

export const telegramUrl = (username: string) => `https://t.me/${username}`;
export const sitePageUrl = (siteUrl: string, username: string) =>
  `${siteUrl.replace(/\/$/, "")}/detail/${username}/`;
