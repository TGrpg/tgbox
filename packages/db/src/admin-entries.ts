import { inArray } from "drizzle-orm";
import type { Db } from "./access.ts";
import { entryTags } from "./schema.ts";

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
