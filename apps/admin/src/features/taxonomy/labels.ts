import type { TaxonomyError } from "@tgbox/core";
import type { EntryKind } from "@tgbox/shared";

export const kindLabels: Record<EntryKind, string> = {
  channel: "频道",
  group: "群组",
  bot: "机器人",
};

export const taxonomyErrorLabels: Record<TaxonomyError, string> = {
  invalid: "请检查输入：slug 仅限小写字母、数字和连字符，名称不能为空",
  slug_taken: "slug 已被占用",
  not_found: "条目不存在，可能已被删除",
  in_use: "仍有条目或待审核投稿使用该分类，无法删除",
};
