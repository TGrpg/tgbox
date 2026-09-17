import type { EntryKind, EntrySort, EntryStatus, Liveness, SubmissionStatus } from "@tgbox/shared";
import { and, asc, count, desc, eq, gte, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { auditLog, entries, entryStats, siteState, submissions } from "./schema.ts";

// Admin reads run on live D1 and are billed by rows scanned. Traffic is a handful of admins, so
// list/filter queries may scan `entries` (no secondary indexes by design, see .agents/database.md);
// pagination is LIMIT/OFFSET over the integer primary key to keep each page bounded.

const DAY_MS = 24 * 60 * 60 * 1000;

/* --------------------------------------------------------------- audit log */

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLog = Omit<typeof auditLog.$inferInsert, "id">;

/** The insert query, for callers that batch it with the change it records. */
export function auditLogInsert(db: Db, row: NewAuditLog) {
  return db.insert(auditLog).values(row);
}

export async function insertAuditLog(db: Db, row: NewAuditLog) {
  await auditLogInsert(db, row).run();
}

/** Newest first. `cursor` is the smallest id of the previous page. */
export async function listAuditLog(db: Db, { limit, cursor }: { limit: number; cursor?: number }) {
  const take = Math.max(1, Math.min(limit, 200));
  const rows = await db
    .select()
    .from(auditLog)
    .where(cursor === undefined ? undefined : lt(auditLog.id, cursor))
    .orderBy(desc(auditLog.id))
    .limit(take + 1);
  const page = rows.slice(0, take);
  return { rows: page, nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null };
}

/* ------------------------------------------------------------------- stats */

export async function adminStats(db: Db, now: number) {
  const [grouped, pending, hidden, state] = await db.batch([
    db
      .select({ kind: entries.kind, status: entries.status, count: count() })
      .from(entries)
      .groupBy(entries.kind, entries.status),
    db.select({ count: count() }).from(submissions).where(eq(submissions.status, "pending")),
    // updated_at is set by the hide transition; a later edit of a still-hidden entry also counts.
    db
      .select({ count: count() })
      .from(entries)
      .where(and(eq(entries.status, "hidden_by_system"), gte(entries.updatedAt, now - 7 * DAY_MS))),
    db
      .select()
      .from(siteState)
      .where(inArray(siteState.key, ["dirty_since", "last_build_at"])),
  ]);

  const byStatus: Record<EntryStatus, number> = {
    approved: 0,
    hidden_by_system: 0,
    hidden_by_admin: 0,
    removed: 0,
  };
  const byKind: Record<EntryKind, number> = { channel: 0, group: 0, bot: 0 };
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] += row.count;
    // Kind counts describe what is listed on the site.
    if (row.status === "approved") byKind[row.kind] += row.count;
    total += row.count;
  }
  const stateValue = (key: string) => {
    const value = state.find((row) => row.key === key)?.value;
    const number = Number(value);
    return value === undefined || !Number.isFinite(number) ? null : number;
  };
  return {
    total,
    byStatus,
    byKind,
    pendingSubmissions: pending[0]?.count ?? 0,
    hiddenBySystemLast7d: hidden[0]?.count ?? 0,
    dirtySince: stateValue("dirty_since"),
    lastBuildAt: stateValue("last_build_at"),
  };
}
export type AdminStats = Awaited<ReturnType<typeof adminStats>>;

/* ----------------------------------------------------------------- entries */

export type EntriesAdminQuery = {
  page: number;
  pageSize: number;
  kind?: EntryKind;
  categoryId?: number;
  status?: EntryStatus;
  liveness?: Liveness;
  lang?: string;
  promoted?: boolean;
  /** substring of username or title */
  q?: string;
  sort?: EntrySort;
};

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

const pageOf = (page: number, pageSize: number) => {
  const size = Math.max(1, Math.min(Math.trunc(pageSize) || 1, 100));
  const index = Math.max(1, Math.trunc(page) || 1);
  return { limit: size, offset: (index - 1) * size };
};

export async function listEntriesAdmin(db: Db, query: EntriesAdminQuery) {
  const conditions: (SQL | undefined)[] = [
    query.kind === undefined ? undefined : eq(entries.kind, query.kind),
    query.categoryId === undefined ? undefined : eq(entries.categoryId, query.categoryId),
    query.status === undefined ? undefined : eq(entries.status, query.status),
    query.liveness === undefined ? undefined : eq(entries.liveness, query.liveness),
    query.lang === undefined ? undefined : eq(entries.lang, query.lang),
    query.promoted === undefined ? undefined : eq(entries.isPromoted, query.promoted),
  ];
  const q = query.q?.trim().toLowerCase();
  if (q) {
    const pattern = likePattern(q);
    conditions.push(
      or(
        sql`${entries.username} LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${entries.title}) LIKE ${pattern} ESCAPE '\\'`,
      ),
    );
  }
  const where = and(...conditions);
  const order = {
    id_desc: [desc(entries.id)],
    id_asc: [asc(entries.id)],
    members_desc: [sql`${entryStats.members} DESC NULLS LAST`, desc(entries.id)],
    updated_desc: [desc(entries.updatedAt), desc(entries.id)],
  }[query.sort ?? "id_desc"];
  const { limit, offset } = pageOf(query.page, query.pageSize);

  const [rows, totals] = await db.batch([
    db
      .select({ entry: entries, stats: entryStats })
      .from(entries)
      .leftJoin(entryStats, eq(entryStats.entryId, entries.id))
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(entries).where(where),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}

/* ------------------------------------------------------------- submissions */

export async function listSubmissions(
  db: Db,
  query: { status?: SubmissionStatus; page: number; pageSize?: number },
) {
  const where = query.status === undefined ? undefined : eq(submissions.status, query.status);
  const { limit, offset } = pageOf(query.page, query.pageSize ?? 20);
  const [rows, totals] = await db.batch([
    db
      .select()
      .from(submissions)
      .where(where)
      // Pending queue reads oldest first; history newest first.
      .orderBy(query.status === "pending" ? asc(submissions.id) : desc(submissions.id))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(submissions).where(where),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}

/** Returns true if the promoted flag changed. */
export async function setEntryPromoted(db: Db, id: number, promoted: boolean, now: number) {
  const result = await db
    .update(entries)
    .set({ isPromoted: promoted, updatedAt: now })
    .where(and(eq(entries.id, id), sql`${entries.isPromoted} IS NOT ${promoted ? 1 : 0}`))
    .run();
  return result.meta.changes > 0;
}

export async function getEntryWithStats(db: Db, id: number) {
  const [row] = await db
    .select({ entry: entries, stats: entryStats })
    .from(entries)
    .leftJoin(entryStats, eq(entryStats.entryId, entries.id))
    .where(eq(entries.id, id));
  return row;
}
