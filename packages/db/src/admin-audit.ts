import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./access.ts";
import { auditLog } from "./schema.ts";

export type AuditLogQuery = { limit: number; cursor?: number; action?: string; actor?: string };

/**
 * Newest first, optionally filtered by exact action/actor. `cursor` is the smallest id of the
 * previous page. Filters scan audit_log (primary key only, by design).
 */
export async function listAuditLogFiltered(db: Db, query: AuditLogQuery) {
  const take = Math.max(1, Math.min(query.limit, 100));
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        query.cursor === undefined ? undefined : lt(auditLog.id, query.cursor),
        query.action === undefined ? undefined : eq(auditLog.action, query.action),
        query.actor === undefined ? undefined : eq(auditLog.actor, query.actor),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(take + 1);
  const page = rows.slice(0, take);
  return { rows: page, nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null };
}

/** Distinct actors, for the filter menu. */
export async function listAuditActors(db: Db) {
  const rows = await db.selectDistinct({ actor: auditLog.actor }).from(auditLog);
  return rows.map((row) => row.actor).sort();
}
