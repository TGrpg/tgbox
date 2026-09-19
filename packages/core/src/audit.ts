import { insertAuditLog } from "@tgbox/db";
import type { Actor, CoreContext } from "./context.ts";

export const auditActions = [
  "submission.approve",
  "submission.reject",
  "entry.list",
  "entry.status",
  "entry.category",
  "entry.tags",
  "entry.promote",
  "entry.posts",
  "post.hidden",
  "entry.refresh",
  "build.trigger",
  "blacklist.add",
  "blacklist.remove",
  "category.create",
  "category.update",
  "category.delete",
  "category.reorder",
  "tag.create",
  "tag.update",
  "tag.delete",
  "settings.update",
  "credential.set",
  "product.upsert",
  "product.slots",
  "order.create",
  "order.paid",
  "order.reject",
  "order.refund",
  "order.cleanup",
  "promotion.start",
  "promotion.end",
  "promotion.extend",
  "promotion.expire",
  "user.message",
  "broadcast.create",
  "broadcast.pause",
  "broadcast.resume",
  "broadcast.cancel",
  "friendLink.approve",
  "friendLink.reject",
  "friendLink.update",
  /** An incoming USDT transfer that matched no order: wrong amount, or paid twice. */
  "usdt.unmatched",
] as const;
export type AuditAction = (typeof auditActions)[number];

export function audit(
  ctx: CoreContext,
  actor: Actor,
  action: AuditAction,
  target: string | null,
  payload: unknown = null,
) {
  return insertAuditLog(ctx.db, { actor, action, target, payload, createdAt: ctx.now() });
}
