import type { EntryStatus, Liveness } from "@tgbox/shared";
import { categories as categoryDefs, tags as tagDefs } from "@tgbox/shared";
import { and, between, count, eq, gte, inArray, max, or, SQL, sql } from "drizzle-orm";
import { type AnyD1Database, drizzle } from "drizzle-orm/d1";
import {
  integer,
  SQLiteAsyncDialect,
  type SQLiteColumn,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import * as schema from "./schema.ts";
import {
  blacklist,
  botDrafts,
  categories,
  entries,
  entryStats,
  entryTags,
  siteState,
  submissions,
  tags,
} from "./schema.ts";

export function createDb(d1: AnyD1Database) {
  return drizzle(d1, { schema });
}
export type Db = ReturnType<typeof createDb>;

export type Entry = typeof entries.$inferSelect;
export type EntryStats = typeof entryStats.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type BlacklistType = (typeof blacklist.$inferSelect)["type"];

// Created by the hand-written migration 0001; declared here (not in schema.ts) so drizzle-kit ignores it.
const entriesFts = sqliteTable("entries_fts", {
  rowid: integer().notNull(),
  title: text().notNull(),
  username: text().notNull(),
  tagNames: text("tag_names").notNull(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

// Telegram usernames are case-insensitive; store and look them up lowercased so the unique index holds.
const canonical = (username: string) => username.toLowerCase();

type RunResult = { meta: { rows_written: number } };
export const written = (results: RunResult[]) =>
  results.reduce((sum, result) => sum + result.meta.rows_written, 0);

const dialect = new SQLiteAsyncDialect();

// drizzle's d1 batch can't run raw `sql` statements, so mixed batches go through D1 directly.
export async function batchWrite(
  db: Db,
  queries: (SQL | { toSQL(): { sql: string; params: unknown[] } })[],
) {
  const statements = queries.map((query) => {
    const { sql: text, params } = query instanceof SQL ? dialect.sqlToQuery(query) : query.toSQL();
    return db.$client.prepare(text).bind(...params);
  });
  return db.$client.batch(statements);
}

/* ---------------------------------------------------------------- taxonomy */

/**
 * Seeds categories and tags from `@tgbox/shared` (tests, fresh databases). D1 is the source of
 * truth once seeded — admins edit names/sort/icons there — so existing rows are never overwritten.
 */
export async function syncTaxonomy(db: Db) {
  const [first, ...rest] = [
    ...categoryDefs.map((category) => db.insert(categories).values(category).onConflictDoNothing()),
    ...tagDefs.map((tag) => db.insert(tags).values(tag).onConflictDoNothing()),
  ];
  if (!first) return { rowsWritten: 0 };
  return { rowsWritten: written(await db.batch([first, ...rest])) };
}

export function listCategories(db: Db) {
  return db.select().from(categories).orderBy(categories.kind, categories.sort);
}

export function listTags(db: Db) {
  return db.select().from(tags).orderBy(tags.id);
}

/* ----------------------------------------------------------------- entries */

export async function getEntryByUsername(db: Db, username: string) {
  const [row] = await db
    .select()
    .from(entries)
    .where(eq(entries.username, canonical(username)));
  return row;
}

/** Entries (any status) with their stats, for the id-sliced refresh batches. Inclusive range. */
export function getEntriesByIdRange(db: Db, from: number, to: number) {
  return db
    .select({ entry: entries, stats: entryStats })
    .from(entries)
    .leftJoin(entryStats, eq(entryStats.entryId, entries.id))
    .where(between(entries.id, from, to))
    .orderBy(entries.id);
}

export async function getMaxEntryId(db: Db) {
  const [row] = await db.select({ value: max(entries.id) }).from(entries);
  return row?.value ?? 0;
}

export async function getEntryTagIds(db: Db, entryId: number) {
  const rows = await db
    .select({ tagId: entryTags.tagId })
    .from(entryTags)
    .where(eq(entryTags.entryId, entryId));
  return rows.map((row) => row.tagId);
}

/**
 * Conditional upsert: 0 rows written when members/online/activity tier are unchanged.
 * Thresholds (≥1% change or ≥7 days) are the caller's decision.
 */
export async function upsertEntryStats(db: Db, stats: typeof entryStats.$inferInsert) {
  const result = await db
    .insert(entryStats)
    .values(stats)
    .onConflictDoUpdate({
      target: entryStats.entryId,
      set: {
        members: sql`excluded.members`,
        online: sql`excluded.online`,
        activityTier: sql`excluded.activity_tier`,
        statsWrittenAt: sql`excluded.stats_written_at`,
      },
      setWhere: sql`${entryStats.members} IS NOT excluded.members OR ${entryStats.online} IS NOT excluded.online OR ${entryStats.activityTier} IS NOT excluded.activity_tier`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

// Rebuilds one FTS row from entries + entry_tags. Tag names carry both languages.
function ftsDelete(entryId: number) {
  return sql`DELETE FROM entries_fts WHERE rowid = ${entryId}`;
}
export function ftsInsert(where: SQL) {
  return sql`
    INSERT INTO entries_fts (rowid, title, username, tag_names)
    SELECT e.id, e.title, e.username, coalesce((
      SELECT group_concat(t.name_zh || ' ' || t.name_en, ' ')
      FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id
    ), '')
    FROM entries e WHERE ${where}`;
}

function differs(column: SQLiteColumn, value: unknown) {
  if (value === undefined) return undefined;
  return sql`${column} IS NOT ${sql.param(value, column)}`;
}

export type ColdFields = Partial<
  Pick<
    Entry,
    "username" | "title" | "description" | "lang" | "verified" | "avatarVersion" | "tgCreatedAt"
  >
>;

/**
 * Updates cold fields only if at least one differs (0 rows otherwise).
 * The FTS row is rewritten only when title or username actually changed.
 */
export async function updateEntryCold(db: Db, id: number, fields: ColdFields, now: number) {
  const values = {
    ...fields,
    ...(fields.username === undefined ? {} : { username: canonical(fields.username) }),
  };
  const changed = or(
    differs(entries.username, values.username),
    differs(entries.title, values.title),
    differs(entries.description, values.description),
    differs(entries.lang, values.lang),
    differs(entries.verified, values.verified),
    differs(entries.avatarVersion, values.avatarVersion),
    differs(entries.tgCreatedAt, values.tgCreatedAt),
  );
  if (!changed) return { rowsWritten: 0 };

  const update = db
    .update(entries)
    .set({ ...values, updatedAt: now })
    .where(and(eq(entries.id, id), changed));
  const ftsChanged = or(
    differs(entriesFts.title, values.title),
    differs(entriesFts.username, values.username),
  );
  if (!ftsChanged) return { rowsWritten: (await update.run()).meta.rows_written };

  const results = await batchWrite(db, [
    update,
    sql`DELETE FROM entries_fts WHERE rowid = ${id} AND (${ftsChanged})`,
    ftsInsert(sql`e.id = ${id} AND NOT EXISTS (SELECT 1 FROM entries_fts WHERE rowid = ${id})`),
  ]);
  return { rowsWritten: written(results) };
}

export type LivenessCheck = {
  /** Result of this check. */
  liveness: Liveness;
  now: number;
  /** False when the batch failure rate exceeded 5%: record the failure but never hide. */
  allowHide: boolean;
};

const HIDE_AFTER: Record<Exclude<Liveness, "active" | "unknown">, number> = {
  not_found: 3,
  banned: 2,
  type_changed: 2,
};
const NOT_FOUND_MIN_SPAN_MS = 2 * DAY_MS;

/**
 * Applies a liveness result to an entry previously read from D1.
 * `unknown` and an already-clean active entry write nothing.
 */
export async function recordLivenessResult(
  db: Db,
  entry: Pick<Entry, "id" | "status" | "liveness" | "failCount" | "firstFailAt">,
  check: LivenessCheck,
) {
  const { liveness, now } = check;
  if (liveness === "unknown") return { rowsWritten: 0, transition: null };

  if (liveness === "active") {
    const restore = entry.status === "hidden_by_system";
    if (!restore && entry.failCount === 0 && entry.liveness === "active") {
      return { rowsWritten: 0, transition: null };
    }
    const result = await db
      .update(entries)
      .set({
        liveness,
        failCount: 0,
        firstFailAt: null,
        lastFailAt: null,
        // Guarded in SQL so a concurrent admin status change is not overwritten.
        status: sql`CASE WHEN ${entries.status} = 'hidden_by_system' THEN 'approved' ELSE ${entries.status} END`,
        updatedAt: now,
      })
      .where(eq(entries.id, entry.id))
      .run();
    return { rowsWritten: result.meta.rows_written, transition: restore ? "restored" : null };
  }

  const failCount = entry.failCount + 1;
  const firstFailAt = entry.firstFailAt ?? now;
  const hide =
    check.allowHide &&
    entry.status === "approved" &&
    failCount >= HIDE_AFTER[liveness] &&
    (liveness !== "not_found" || now - firstFailAt >= NOT_FOUND_MIN_SPAN_MS);
  const result = await db
    .update(entries)
    .set({
      liveness,
      failCount,
      firstFailAt,
      lastFailAt: now,
      updatedAt: now,
      ...(hide
        ? {
            status: sql`CASE WHEN ${entries.status} = 'approved' THEN 'hidden_by_system' ELSE ${entries.status} END`,
          }
        : {}),
    })
    .where(eq(entries.id, entry.id))
    .run();
  return { rowsWritten: result.meta.rows_written, transition: hide ? "hidden" : null };
}

export type NewEntry = Omit<
  typeof entries.$inferInsert,
  "id" | "status" | "liveness" | "failCount" | "firstFailAt" | "lastFailAt" | "updatedAt"
>;

/** Writes entries + entry_stats + entry_tags + FTS in one batch (transaction). */
export async function insertApprovedEntry(
  db: Db,
  input: {
    entry: NewEntry;
    stats: Omit<typeof entryStats.$inferInsert, "entryId">;
    tagIds: number[];
    now: number;
  },
) {
  const username = canonical(input.entry.username);
  const idOf = sql`(SELECT id FROM entries WHERE username = ${username})`;
  const results = await batchWrite(db, [
    db
      .insert(entries)
      .values({ ...input.entry, username, status: "approved", updatedAt: input.now }),
    sql`
      INSERT INTO entry_stats (entry_id, members, online, activity_tier, stats_written_at)
      VALUES (${idOf}, ${input.stats.members ?? null}, ${input.stats.online ?? null},
        ${input.stats.activityTier ?? null}, ${input.stats.statsWrittenAt})`,
    sql`
      INSERT OR IGNORE INTO entry_tags (entry_id, tag_id)
      SELECT ${idOf}, t.id FROM tags t WHERE t.id IN (SELECT value FROM json_each(${JSON.stringify(input.tagIds)}))`,
    ftsInsert(sql`e.username = ${username}`),
  ]);
  const id = results[0]?.meta.last_row_id;
  if (id === undefined) throw new Error(`insertApprovedEntry: no id for ${username}`);
  return { id, rowsWritten: written(results) };
}

/** Returns true if the status changed. */
export async function setEntryStatus(db: Db, id: number, status: EntryStatus, now: number) {
  const result = await db
    .update(entries)
    .set({ status, updatedAt: now })
    .where(and(eq(entries.id, id), differs(entries.status, status)))
    .run();
  return result.meta.changes > 0;
}

/** Returns true if the category changed. */
export async function setEntryCategory(db: Db, id: number, categoryId: number, now: number) {
  const result = await db
    .update(entries)
    .set({ categoryId, updatedAt: now })
    .where(and(eq(entries.id, id), differs(entries.categoryId, categoryId)))
    .run();
  return result.meta.changes > 0;
}

/** Replaces an entry's tags; writes nothing (and leaves FTS alone) when the set is unchanged. */
export async function setEntryTags(db: Db, id: number, tagIds: number[], now: number) {
  const current = new Set(await getEntryTagIds(db, id));
  const next = new Set(tagIds);
  if (current.size === next.size && [...next].every((tagId) => current.has(tagId))) {
    return { rowsWritten: 0 };
  }
  const json = JSON.stringify([...next]);
  const results = await batchWrite(db, [
    sql`DELETE FROM entry_tags WHERE entry_id = ${id} AND tag_id NOT IN (SELECT value FROM json_each(${json}))`,
    sql`
      INSERT OR IGNORE INTO entry_tags (entry_id, tag_id)
      SELECT ${id}, t.id FROM tags t WHERE t.id IN (SELECT value FROM json_each(${json}))`,
    db.update(entries).set({ updatedAt: now }).where(eq(entries.id, id)),
    ftsDelete(id),
    ftsInsert(sql`e.id = ${id}`),
  ]);
  return { rowsWritten: written(results) };
}

/**
 * Inline search over approved entries. Queries of ≥3 characters use an FTS phrase MATCH
 * (trigram needs 3); shorter ones fall back to LIKE on the FTS table.
 */
export function searchEntries(db: Db, query: string, limit = 20) {
  const q = query.trim();
  const take = Math.max(1, Math.min(limit, 20));
  const base = db
    .select({ entry: entries, members: entryStats.members })
    .from(entriesFts)
    .innerJoin(entries, eq(entries.id, entriesFts.rowid))
    .leftJoin(entryStats, eq(entryStats.entryId, entries.id));
  if (!q) return Promise.resolve([]);

  if ([...q].length >= 3) {
    const phrase = `"${q.replaceAll('"', '""')}"`;
    return base
      .where(and(sql`entries_fts MATCH ${phrase}`, eq(entries.status, "approved")))
      .orderBy(sql`rank`)
      .limit(take);
  }
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const like = (column: SQLiteColumn) => sql`${column} LIKE ${pattern} ESCAPE '\\'`;
  return base
    .where(
      and(
        or(like(entriesFts.title), like(entriesFts.username), like(entriesFts.tagNames)),
        eq(entries.status, "approved"),
      ),
    )
    .limit(take);
}

/* ------------------------------------------------------------- submissions */

export type NewSubmission = Omit<
  typeof submissions.$inferInsert,
  "id" | "status" | "rejectReason" | "reviewerId" | "reviewedAt" | "adminMessageId"
>;

/** Returns the new submission id, or null if a pending submission for the username already exists. */
export async function createSubmission(db: Db, input: NewSubmission) {
  const [row] = await db
    .insert(submissions)
    .values({ ...input, username: canonical(input.username) })
    .onConflictDoNothing()
    .returning({ id: submissions.id });
  return row?.id ?? null;
}

export async function getSubmission(db: Db, id: number) {
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
  return row;
}

export async function findPendingSubmission(db: Db, username: string) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.username, canonical(username)), eq(submissions.status, "pending")));
  return row;
}

export async function countSubmissionsSince(db: Db, tgUserId: number, since: number) {
  const [row] = await db
    .select({ value: count() })
    .from(submissions)
    .where(and(eq(submissions.tgUserId, tgUserId), gte(submissions.createdAt, since)));
  return row?.value ?? 0;
}

export async function setSubmissionAdminMessage(db: Db, id: number, adminMessageId: number) {
  await db.update(submissions).set({ adminMessageId }).where(eq(submissions.id, id)).run();
}

/** State-machine update; returns false if the submission was not pending (already reviewed). */
/** `reviewerId` is the Telegram user id; null for web admins (see audit_log for the actor). */
export async function approveSubmission(
  db: Db,
  id: number,
  reviewerId: number | null,
  now: number,
) {
  const result = await db
    .update(submissions)
    .set({ status: "approved", reviewerId, reviewedAt: now })
    .where(and(eq(submissions.id, id), eq(submissions.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

export async function rejectSubmission(
  db: Db,
  id: number,
  reviewerId: number | null,
  reason: string | null,
  now: number,
) {
  const result = await db
    .update(submissions)
    .set({ status: "rejected", reviewerId, reviewedAt: now, rejectReason: reason })
    .where(and(eq(submissions.id, id), eq(submissions.status, "pending")))
    .run();
  return result.meta.changes > 0;
}

/* --------------------------------------------------------------- blacklist */

// Username values are lowercased; user values are Telegram user ids as strings.
const blacklistValue = (type: BlacklistType, value: string) =>
  type === "username" ? canonical(value) : value;

export async function getBlacklistEntry(db: Db, type: BlacklistType, value: string) {
  const [row] = await db
    .select()
    .from(blacklist)
    .where(and(eq(blacklist.type, type), eq(blacklist.value, blacklistValue(type, value))));
  return row;
}

/** Returns false if already blacklisted. */
export async function addToBlacklist(
  db: Db,
  input: { type: BlacklistType; value: string; reason: string | null; now: number },
) {
  const result = await db
    .insert(blacklist)
    .values({
      type: input.type,
      value: blacklistValue(input.type, input.value),
      reason: input.reason,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .run();
  return result.meta.changes > 0;
}

export async function removeFromBlacklist(db: Db, type: BlacklistType, value: string) {
  const result = await db
    .delete(blacklist)
    .where(and(eq(blacklist.type, type), eq(blacklist.value, blacklistValue(type, value))))
    .run();
  return result.meta.changes > 0;
}

/* -------------------------------------------------------------- bot drafts */

/** Drafts older than 24 hours are treated as absent (the next put overwrites them). */
export async function getBotDraft(db: Db, tgUserId: number, now: number) {
  const [row] = await db.select().from(botDrafts).where(eq(botDrafts.tgUserId, tgUserId));
  return row && now - row.updatedAt <= DAY_MS ? row : undefined;
}

export async function putBotDraft(db: Db, draft: typeof botDrafts.$inferInsert) {
  await db
    .insert(botDrafts)
    .values(draft)
    .onConflictDoUpdate({
      target: botDrafts.tgUserId,
      set: { step: draft.step, payload: draft.payload, updatedAt: draft.updatedAt },
    })
    .run();
}

export async function deleteBotDraft(db: Db, tgUserId: number) {
  await db.delete(botDrafts).where(eq(botDrafts.tgUserId, tgUserId)).run();
}

/* -------------------------------------------------------------- site state */

export async function getSiteState(db: Db, key: string) {
  const [row] = await db.select().from(siteState).where(eq(siteState.key, key));
  return row?.value;
}

/** Several keys in one query, for callers on a tight subrequest budget (the hourly cron). */
export async function getSiteStates(db: Db, keys: string[]) {
  const rows = await db.select().from(siteState).where(inArray(siteState.key, keys));
  const state: Record<string, string | undefined> = {};
  for (const row of rows) state[row.key] = row.value;
  return state;
}

/** Conditional upsert: 0 rows written when the value is unchanged. */
export async function setSiteState(db: Db, key: string, value: string) {
  const result = await db
    .insert(siteState)
    .values({ key, value })
    .onConflictDoUpdate({
      target: siteState.key,
      set: { value: sql`excluded.value` },
      setWhere: sql`${siteState.value} IS NOT excluded.value`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Sets `dirty_since` if unset. Returns true only on the empty → dirty transition,
 * which is when the bot should dispatch a build (debounce).
 */
export async function markDirty(db: Db, now: number) {
  const result = await db
    .insert(siteState)
    .values({ key: "dirty_since", value: String(now) })
    .onConflictDoNothing()
    .run();
  return result.meta.changes > 0;
}

/** Clears `dirty_since` only if it was set before the build started. Returns true if cleared. */
export async function clearDirty(db: Db, buildStartedAt: number) {
  const result = await db
    .delete(siteState)
    .where(
      and(
        eq(siteState.key, "dirty_since"),
        sql`CAST(${siteState.value} AS INTEGER) < ${buildStartedAt}`,
      ),
    )
    .run();
  return result.meta.changes > 0;
}
