import type { OrderStatus, PaymentProvider, ProductKind } from "@tgbox/shared";

type BadgeVariant = "success" | "warning" | "error" | "info" | "secondary" | "outline";

export const productKindLabels: Record<ProductKind, string> = { pin: "置顶", banner: "横幅" };

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  active: "投放中",
  expired: "已到期",
  rejected: "已拒绝",
  refunded: "已退款",
  cancelled: "已取消",
};

export const orderStatusVariants: Record<OrderStatus, BadgeVariant> = {
  pending: "outline",
  paid: "warning",
  active: "success",
  expired: "secondary",
  rejected: "error",
  refunded: "info",
  cancelled: "secondary",
};

export const orderStatusOptions = (Object.keys(orderStatusLabels) as OrderStatus[]).map(
  (value) => ({ value, label: orderStatusLabels[value] }),
);

export const providerLabels: Record<PaymentProvider, string> = {
  stars: "Stars",
  cryptopay: "Crypto Pay",
  usdt: "USDT·TRC20",
  manual: "手动",
};

export function formatAmount(amount: string | null, currency: string | null) {
  if (amount === null) return "—";
  return currency === "XTR" ? `${amount} ⭐` : `${amount} ${currency ?? ""}`.trim();
}

export const dateTime = (ms: number | null) =>
  ms === null
    ? "—"
    : new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

/** `YYYY-MM-DD` (UTC day key of promotion_clicks) as `M/D`, without re-parsing it as local time. */
export const shortDay = (day: string) => {
  const [, month = "", date = ""] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
};

/** Window shown next to the lifetime total; must match RECENT_DAYS in @tgbox/core. */
export const RECENT_LABEL = "近 7 天";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left, rounded up; a promotion ending in 2 hours still has "1 day". */
export const remainingDays = (endsAt: number, now: number) =>
  Math.max(0, Math.ceil((endsAt - now) / DAY_MS));

export const promotionErrorText: Record<string, string> = {
  invalid_target: "用户名格式不正确",
  target_not_listed: "该用户名不是已收录的条目",
  invalid_banner: "横幅内容不符合要求：标题 ≤ 20 字、副标题 ≤ 40 字、链接以 https:// 开头",
  invalid_days: "天数需在 1–365 之间",
};
