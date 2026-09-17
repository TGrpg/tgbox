import type { Entry } from "@tgbox/db";
import type { EntryKind } from "@tgbox/shared";

export type SubmissionSummary = {
  username: string;
  kind: EntryKind;
  title: string;
  description: string;
  members: number | null;
  category: string;
  tags: string[];
  submitter: string;
  submitterUsername: string | null;
  submitterId: number;
};

export type EntryStatusSummary = {
  entry: Entry;
  members: number | null;
  category: string;
  tags: string[];
};

const zhKinds = { channel: "频道", group: "群组", bot: "机器人" };

export const zh = {
  welcome:
    "欢迎使用 TGbox收录机器人！\n\n直接发送频道、群组或机器人的链接（https://t.me/xxx、t.me/xxx 或 @xxx）即可提交收录。",
  submitButton: "提交收录",
  help: "收录标准：公开的频道、群组或机器人，内容合法、持续更新、无刷粉。\n\n提交方式：发送 t.me 链接或 @用户名，按提示选择分类和标签。\n审核结果会通过私信通知。有问题请联系管理员。",
  sendLink: "请发送要提交的频道、群组或机器人链接（https://t.me/xxx、t.me/xxx 或 @xxx）。",
  invalidLink:
    "无法识别链接。请发送 https://t.me/xxx、t.me/xxx 或 @xxx 格式的公开用户名（邀请链接不支持）。",
  alreadyListed: (username: string) => `@${username} 已经收录，无需重复提交。`,
  alreadyPending: (username: string) => `@${username} 已在审核中，请耐心等待。`,
  dailyLimit: (limit: number) => `今天的提交次数已达上限（${limit} 次），请明天再试。`,
  notFound: (username: string) => `@${username} 不存在，请检查用户名。`,
  banned: (username: string) => `@${username} 已被 Telegram 封禁或限制，无法收录。`,
  checking: (username: string) => `正在检查 @${username}…`,
  unavailable: "暂时无法获取资料，请稍后再试。",
  userAccount: (username: string) => `@${username} 是个人账号，只能收录公开的频道、群组和机器人。`,
  kinds: zhKinds,
  members: "成员",
  profile: (kind: string, title: string, username: string) => `${kind}：${title}（@${username}）`,
  chooseCategory: "请选择分类：",
  chooseTags: (count: number, max: number) => `请选择标签（可选，已选 ${count}/${max}）：`,
  tagsDone: "完成",
  prevPage: "« 上一页",
  nextPage: "下一页 »",
  confirmTitle: "请确认提交信息：",
  category: "分类",
  tags: "标签",
  none: "无",
  confirm: "✅ 确认提交",
  editCategory: "修改分类",
  editTags: "修改标签",
  cancel: "取消",
  cancelled: "已取消。随时发送链接重新开始。",
  expired: "按钮已过期，请重新发送链接开始。",
  submitted: "已提交，等待审核。审核结果会私信通知你。",
  noPermission: "没有权限。",
  alreadyHandled: "已处理。",
  approvedNotice: (username: string) =>
    `🎉 你提交的 @${username} 已通过审核并收录，网站几分钟后更新。`,
  rejectedNotice: (username: string, reason: string) =>
    `很抱歉，你提交的 @${username} 未通过审核。原因：${reason}`,
  openTelegram: "打开 Telegram",
  openSite: "网站详情",
  admin: {
    newSubmission: (s: SubmissionSummary) =>
      [
        "📥 新提交",
        `${zhKinds[s.kind]}：${s.title}`,
        `https://t.me/${s.username}`,
        `成员：${s.members ?? "未知"}`,
        `分类：${s.category}`,
        `标签：${s.tags.length ? s.tags.join("、") : "无"}`,
        `提交人：${s.submitter}${s.submitterUsername ? ` @${s.submitterUsername}` : ""}（${s.submitterId}）`,
        "",
        s.description.slice(0, 500),
      ].join("\n"),
    approve: "✅ 通过",
    reject: "❌ 拒绝",
    back: "« 返回",
    approvedBy: (name: string) => `✅ 已通过（${name}）`,
    rejectedBy: (name: string, reason: string) => `❌ 已拒绝（${name}）：${reason}`,
    reasons: {
      content: "内容违规",
      grey: "灰黑产",
      fake_subs: "僵尸粉",
      inactive: "长期停更",
      duplicate: "重复",
      other: "其他",
    },
    banUsage: "用法：/ban <用户ID|@用户名> [原因]",
    unbanUsage: "用法：/unban <用户ID|@用户名>",
    banned: (target: string) => `已拉黑 ${target}`,
    unbanned: (target: string) => `已解除拉黑 ${target}`,
    notBanned: (target: string) => `${target} 不在黑名单中`,
    entryUsage: (command: string) => `用法：/${command} @用户名`,
    setcatUsage: "用法：/setcat @用户名 <分类slug>",
    settagsUsage: "用法：/settags @用户名 tag1,tag2",
    entryNotFound: (username: string) => `未找到条目 @${username}`,
    statusSet: (username: string, status: string, changed: boolean) =>
      changed ? `@${username} 状态已改为 ${status}` : `@${username} 状态已是 ${status}`,
    unknownCategory: (slug: string, kind: string) => `分类 "${slug}" 不存在（类型 ${kind}）`,
    categorySet: (username: string, slug: string, changed: boolean) =>
      changed ? `@${username} 分类已改为 ${slug}` : `@${username} 分类未变化`,
    unknownTags: (slugs: string[]) => `未知标签：${slugs.join(", ")}`,
    tooManyTags: (max: number) => `最多 ${max} 个标签`,
    tagsSet: (username: string, slugs: string[], changed: boolean) =>
      changed ? `@${username} 标签已改为 ${slugs.join(", ") || "无"}` : `@${username} 标签未变化`,
    status: (s: EntryStatusSummary) =>
      [
        `@${s.entry.username}（${s.entry.kind}）${s.entry.title}`,
        `状态：${s.entry.status}`,
        `检测：${s.entry.liveness}，连续失败 ${s.entry.failCount} 次${s.entry.lastFailAt ? `，最近失败 ${new Date(s.entry.lastFailAt).toISOString()}` : ""}`,
        `成员：${s.members ?? "未知"}`,
        `分类：${s.category}`,
        `标签：${s.tags.join(", ") || "无"}`,
        `收录于：${new Date(s.entry.listedAt).toISOString()}`,
      ].join("\n"),
  },
};
