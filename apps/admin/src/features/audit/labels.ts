import type { AuditAction } from "@tgbox/core";

export const auditActionLabels: Record<AuditAction, string> = {
  "submission.approve": "通过投稿",
  "submission.reject": "拒绝投稿",
  "entry.list": "收录条目",
  "entry.status": "修改状态",
  "entry.category": "修改分类",
  "entry.tags": "修改标签",
  "entry.promote": "推荐设置",
  "entry.refresh": "刷新条目",
  "build.trigger": "触发构建",
  "blacklist.add": "加入黑名单",
  "blacklist.remove": "移出黑名单",
  "category.create": "新增分类",
  "category.update": "编辑分类",
  "category.delete": "删除分类",
  "category.reorder": "分类排序",
  "tag.create": "新增标签",
  "tag.update": "编辑标签",
  "tag.delete": "删除标签",
};

export function isAuditAction(action: string): action is AuditAction {
  return Object.hasOwn(auditActionLabels, action);
}

/** Client-side list of actions (avoids bundling @tgbox/core into the browser). */
export const auditActionOptions = Object.keys(auditActionLabels).filter(isAuditAction);

export const auditActionLabel = (action: string) =>
  isAuditAction(action) ? auditActionLabels[action] : action;
