import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { supportThreads } from "./schema.ts";

export type SupportThread = typeof supportThreads.$inferSelect;

/** The user's forum topic in the support group, if one was ever created. */
export async function getSupportThread(db: Db, tgUserId: number) {
  const [row] = await db.select().from(supportThreads).where(eq(supportThreads.tgUserId, tgUserId));
  return row;
}

/** The user behind a `message_thread_id` — the admin side of the relay. */
export async function getSupportThreadByTopic(db: Db, topicId: number) {
  const [row] = await db.select().from(supportThreads).where(eq(supportThreads.topicId, topicId));
  return row;
}

/**
 * Records the user's topic. Written once per user; the update path only matters when the topic was
 * deleted in Telegram and the relay had to create a new one.
 */
export async function upsertSupportThread(
  db: Db,
  input: { tgUserId: number; topicId: number; now: number },
) {
  const result = await db
    .insert(supportThreads)
    .values({
      tgUserId: input.tgUserId,
      topicId: input.topicId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: supportThreads.tgUserId,
      set: { topicId: sql`excluded.topic_id`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`${supportThreads.topicId} IS NOT excluded.topic_id`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Keeps `updated_at` roughly fresh without paying a write per relayed message: 0 rows written
 * unless the row is already older than `maxAgeMs`.
 */
export async function touchSupportThread(
  db: Db,
  input: { tgUserId: number; now: number; maxAgeMs: number },
) {
  const result = await db
    .update(supportThreads)
    .set({ updatedAt: input.now })
    .where(
      and(
        eq(supportThreads.tgUserId, input.tgUserId),
        lt(supportThreads.updatedAt, input.now - input.maxAgeMs),
      ),
    )
    .run();
  return { rowsWritten: result.meta.rows_written };
}
