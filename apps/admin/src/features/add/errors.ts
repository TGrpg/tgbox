import type { ListEntryError } from "@tgbox/core";

export type AddEntryError = ListEntryError | "pending_submission" | "blacklisted";

export const addEntryErrorText: Record<AddEntryError, string> = {
  invalid_username: "用户名或链接格式不正确",
  already_listed: "该用户名已收录",
  pending_submission: "该用户名有待审核的提交，请在审核队列处理",
  blacklisted: "该用户名在黑名单中",
  unknown_category: "分类不存在或与类型不匹配",
  unknown_tags: "包含不存在的标签",
  too_many_tags: "标签数量超出上限",
  user_account: "这是个人账号，不能收录",
  not_found: "t.me 上找不到该用户名",
  banned: "该频道/群组已被 Telegram 封禁",
  unavailable: "暂时无法获取资料（可能是网络问题或类型无法识别），请稍后重试",
};
