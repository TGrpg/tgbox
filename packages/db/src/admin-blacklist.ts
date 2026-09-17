import { count, desc } from "drizzle-orm";
import { type Db, pageOf } from "./access.ts";
import { blacklist } from "./schema.ts";

/**
 * Newest first, one page at a time. The blacklist is hand-maintained and normally small, but it
 * only ever grows, so the admin page must not scan the whole table on every visit.
 */
export async function listBlacklist(db: Db, query: { page: number; pageSize?: number }) {
  const { limit, offset } = pageOf(query.page, query.pageSize ?? 50);
  const [rows, totals] = await db.batch([
    db.select().from(blacklist).orderBy(desc(blacklist.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(blacklist),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}
