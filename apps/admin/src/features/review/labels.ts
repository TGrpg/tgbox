import type { RejectReason } from "@tgbox/core";
import type { EntryKind, Liveness } from "@tgbox/shared";

export const kindLabels: Record<EntryKind, string> = {
  channel: "频道",
  group: "群组",
  bot: "机器人",
};

export const rejectReasonLabels: Record<RejectReason, string> = {
  content: "内容违规",
  grey: "灰黑产",
  fake_subs: "僵尸粉",
  inactive: "长期停更",
  duplicate: "重复",
  other: "其他",
};

export const rejectReasonOptions: { value: RejectReason; label: string }[] = [
  { value: "content", label: rejectReasonLabels.content },
  { value: "grey", label: rejectReasonLabels.grey },
  { value: "fake_subs", label: rejectReasonLabels.fake_subs },
  { value: "inactive", label: rejectReasonLabels.inactive },
  { value: "duplicate", label: rejectReasonLabels.duplicate },
  { value: "other", label: rejectReasonLabels.other },
];

export const livenessLabels: Record<Liveness, string> = {
  active: "正常",
  not_found: "不存在",
  banned: "已封禁",
  type_changed: "类型变化",
  unknown: "未知",
};

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export const compactNumber = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      );

export const rejectReasonLabel = (reason: string | null) =>
  rejectReasonOptions.find((option) => option.value === reason)?.label ?? reason ?? "—";
