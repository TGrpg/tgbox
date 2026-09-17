import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, pageOf } from "./access.ts";
import { entries, entryTags, hiddenPosts } from "./schema.ts";

/** Tag ids per entry for one admin list page (entries without tags are absent). */
export async function listTagIdsForEntries(db: Db, entryIds: number[]) {
  const byEntry = new Map<number, number[]>();
  if (entryIds.length === 0) return byEntry;
  const rows = await db
    .select()
    .from(entryTags)
    .where(inArray(entryTags.entryId, [...new Set(entryIds)]))
    .orderBy(entryTags.entryId, entryTags.tagId);
  for (const row of rows) {
    const list = byEntry.get(row.entryId);
    if (list) list.push(row.tagId);
    else byEntry.set(row.entryId, [row.tagId]);
  }
  return byEntry;
}

/* ----------------------------------------------------------- post moderation */

export type HiddenPost = typeof hiddenPosts.$inferSelect;

/** Hides (or shows) every post preview of one entry. Returns true when the flag changed. */
export async function setEntryHidePosts(
  db: Db,
  input: { entryId: number; hide: boolean; now: number },
) {
  const result = await db
    .update(entries)
    .set({ hidePosts: input.hide, updatedAt: input.now })
    .where(
      and(eq(entries.id, input.entryId), sql`${entries.hidePosts} IS NOT ${input.hide ? 1 : 0}`),
    )
    .run();
  return result.meta.changes > 0;
}

/** Telegram post ids hidden for one entry (the snapshot filters on these). */
export async function listHiddenPostIds(db: Db, entryId: number): Promise<number[]> {
  const rows = await db
    .select({ postId: hiddenPosts.postId })
    .from(hiddenPosts)
    .where(eq(hiddenPosts.entryId, entryId))
    .orderBy(hiddenPosts.postId);
  return rows.map((row) => row.postId);
}

/** Hides or shows a single post. Returns true when the row set actually changed. */
export async function setPostHidden(
  db: Db,
  input: { entryId: number; postId: number; hidden: boolean; now: number },
) {
  const where = and(eq(hiddenPosts.entryId, input.entryId), eq(hiddenPosts.postId, input.postId));
  if (!input.hidden) {
    const result = await db.delete(hiddenPosts).where(where).run();
    return result.meta.changes > 0;
  }
  const result = await db
    .insert(hiddenPosts)
    .values({ entryId: input.entryId, postId: input.postId, createdAt: input.now })
    .onConflictDoNothing()
    .run();
  return result.meta.rows_written > 0;
}

/** Newest first, with the entry's username for the admin table. */
export async function listHiddenPosts(db: Db, query: { page: number; pageSize: number }) {
  const { limit, offset } = pageOf(query.page, query.pageSize);
  const [rows, totals] = await db.batch([
    db
      .select({
        entryId: hiddenPosts.entryId,
        postId: hiddenPosts.postId,
        createdAt: hiddenPosts.createdAt,
        username: entries.username,
      })
      .from(hiddenPosts)
      .leftJoin(entries, eq(entries.id, hiddenPosts.entryId))
      .orderBy(desc(hiddenPosts.createdAt), desc(hiddenPosts.postId))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(hiddenPosts),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}
