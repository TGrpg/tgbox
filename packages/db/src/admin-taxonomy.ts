import type { EntryKind } from "@tgbox/shared";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { batchWrite, type Db, ftsInsert, written } from "./access.ts";
import { categories, entries, entryTags, submissions, tags } from "./schema.ts";

// Taxonomy is small (tens of rows) and edited by hand, so counts are correlated subqueries.
// They are written with literal table names: drizzle renders bare column names in a select list.

export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;

/** Categories ordered by kind + sort, with the number of entries (any status) in each. */
export function listCategoriesWithCounts(db: Db) {
  return db
    .select({
      category: categories,
      entries: sql<number>`(SELECT count(*) FROM entries WHERE entries.category_id = categories.id)`,
    })
    .from(categories)
    .orderBy(asc(categories.kind), asc(categories.sort), asc(categories.id));
}

/** Tags ordered by slug, with the number of entries tagged. */
export function listTagsWithCounts(db: Db) {
  return db
    .select({
      tag: tags,
      entries: sql<number>`(SELECT count(*) FROM entry_tags WHERE entry_tags.tag_id = tags.id)`,
    })
    .from(tags)
    .orderBy(asc(tags.slug));
}

export async function getCategory(db: Db, id: number) {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  return row;
}

export async function getTag(db: Db, id: number) {
  const [row] = await db.select().from(tags).where(eq(tags.id, id));
  return row;
}

/** True if another category of the same kind already uses the slug. */
export async function categorySlugTaken(db: Db, kind: EntryKind, slug: string, exceptId?: number) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.kind, kind),
        eq(categories.slug, slug),
        exceptId === undefined ? undefined : ne(categories.id, exceptId),
      ),
    );
  return row !== undefined;
}

export async function tagSlugTaken(db: Db, slug: string, exceptId?: number) {
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.slug, slug), exceptId === undefined ? undefined : ne(tags.id, exceptId)));
  return row !== undefined;
}

export type CategoryFields = Pick<Category, "slug" | "nameZh" | "nameEn" | "icon">;

/** Appends a category at the end of its kind. Returns null if the slug is taken. */
export async function insertCategory(db: Db, input: CategoryFields & { kind: EntryKind }) {
  const [row] = await db
    .insert(categories)
    .values({
      ...input,
      sort: sql`(SELECT coalesce(max(${categories.sort}), 0) + 10 FROM ${categories} WHERE ${categories.kind} = ${input.kind})`,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Writes only when a field differs. Returns true if the row changed. */
export async function updateCategory(db: Db, id: number, fields: CategoryFields) {
  const result = await db
    .update(categories)
    .set(fields)
    .where(
      and(
        eq(categories.id, id),
        sql`(${categories.slug} IS NOT ${fields.slug} OR ${categories.nameZh} IS NOT ${fields.nameZh} OR ${categories.nameEn} IS NOT ${fields.nameEn} OR ${categories.icon} IS NOT ${fields.icon})`,
      ),
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * Deletes a category nothing references (no entry of any status, no pending submission).
 * Returns "deleted", "in_use" or "not_found".
 */
export async function deleteUnusedCategory(db: Db, id: number) {
  const result = await db
    .delete(categories)
    .where(
      and(
        eq(categories.id, id),
        sql`NOT EXISTS (SELECT 1 FROM ${entries} WHERE ${entries.categoryId} = ${id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${submissions} WHERE ${submissions.categoryId} = ${id} AND ${submissions.status} = 'pending')`,
      ),
    )
    .run();
  if (result.meta.changes > 0) return "deleted";
  return (await getCategory(db, id)) ? "in_use" : "not_found";
}

/** Sets sort = 10, 20, … in the given order; writes only rows whose sort changes. */
export async function reorderCategories(db: Db, kind: EntryKind, ids: number[]) {
  const [first, ...rest] = ids.map((id, index) =>
    db
      .update(categories)
      .set({ sort: (index + 1) * 10 })
      .where(
        and(
          eq(categories.id, id),
          eq(categories.kind, kind),
          sql`${categories.sort} IS NOT ${(index + 1) * 10}`,
        ),
      ),
  );
  if (!first) return { rowsWritten: 0 };
  return { rowsWritten: written(await db.batch([first, ...rest])) };
}

export type TagFields = Pick<Tag, "slug" | "nameZh" | "nameEn">;

/** Returns null if the slug is taken. */
export async function insertTag(db: Db, input: TagFields) {
  const [row] = await db.insert(tags).values(input).onConflictDoNothing().returning();
  return row ?? null;
}

const taggedEntryIds = (tagId: number) =>
  sql`(SELECT ${entryTags.entryId} FROM ${entryTags} WHERE ${entryTags.tagId} = ${tagId})`;

/**
 * Writes only when a field differs. Search rows carry tag names, so a rename rebuilds the FTS rows
 * of the tagged entries. Returns true if the tag changed.
 */
export async function updateTag(db: Db, id: number, fields: TagFields) {
  const [before] = await db.select().from(tags).where(eq(tags.id, id));
  if (!before) return false;
  const result = await db
    .update(tags)
    .set(fields)
    .where(
      and(
        eq(tags.id, id),
        sql`(${tags.slug} IS NOT ${fields.slug} OR ${tags.nameZh} IS NOT ${fields.nameZh} OR ${tags.nameEn} IS NOT ${fields.nameEn})`,
      ),
    )
    .run();
  if (result.meta.changes === 0) return false;
  if (before.nameZh !== fields.nameZh || before.nameEn !== fields.nameEn) {
    await batchWrite(db, [
      sql`DELETE FROM entries_fts WHERE rowid IN ${taggedEntryIds(id)}`,
      ftsInsert(sql`e.id IN ${taggedEntryIds(id)}`),
    ]);
  }
  return true;
}

/** Deletes a tag and its entry_tags rows, and rebuilds the search rows of affected entries. */
export async function deleteTag(db: Db, id: number, now: number) {
  const affected = (
    await db.select({ id: entryTags.entryId }).from(entryTags).where(eq(entryTags.tagId, id))
  ).map((row) => row.id);
  const results = await batchWrite(db, [
    db.delete(tags).where(eq(tags.id, id)),
    db.delete(entryTags).where(eq(entryTags.tagId, id)),
    ...(affected.length > 0
      ? [
          db.update(entries).set({ updatedAt: now }).where(inArray(entries.id, affected)),
          sql`DELETE FROM entries_fts WHERE rowid IN (SELECT value FROM json_each(${JSON.stringify(affected)}))`,
          ftsInsert(sql`e.id IN (SELECT value FROM json_each(${JSON.stringify(affected)}))`),
        ]
      : []),
  ]);
  return { deleted: (results[0]?.meta.changes ?? 0) > 0, affectedEntries: affected };
}
