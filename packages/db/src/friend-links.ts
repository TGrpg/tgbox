import { and, count, desc, eq } from "drizzle-orm";
import { type Db, pageOf } from "./access.ts";
import { type FriendLinkRequestStatus, friendLinkRequests } from "./schema.ts";

export type FriendLinkRequest = typeof friendLinkRequests.$inferSelect;

export async function insertFriendLinkRequest(
  db: Db,
  request: Omit<FriendLinkRequest, "id" | "status" | "reviewedAt">,
) {
  const [row] = await db.insert(friendLinkRequests).values(request).returning();
  if (!row) throw new Error("friend link request insert returned no row");
  return row;
}

export async function getPendingFriendLinkRequest(db: Db, tgUserId: number) {
  const [row] = await db
    .select()
    .from(friendLinkRequests)
    .where(
      and(eq(friendLinkRequests.tgUserId, tgUserId), eq(friendLinkRequests.status, "pending")),
    );
  return row;
}

/** Pending → approved/rejected, once: a second review of the same request gets undefined. */
export async function closeFriendLinkRequest(
  db: Db,
  id: number,
  status: Exclude<FriendLinkRequestStatus, "pending">,
  now: number,
) {
  const [row] = await db
    .update(friendLinkRequests)
    .set({ status, reviewedAt: now })
    .where(and(eq(friendLinkRequests.id, id), eq(friendLinkRequests.status, "pending")))
    .returning();
  return row;
}

/** Newest first, one page at a time. */
export async function listFriendLinkRequests(db: Db, query: { page: number; pageSize?: number }) {
  const { limit, offset } = pageOf(query.page, query.pageSize ?? 50);
  const [rows, totals] = await db.batch([
    db
      .select()
      .from(friendLinkRequests)
      .orderBy(desc(friendLinkRequests.id))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(friendLinkRequests),
  ]);
  return { rows, total: totals[0]?.count ?? 0 };
}
