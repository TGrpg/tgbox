import type { Locale } from "@tgbox/shared";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { entries } from "./schema.ts";

/** One entry waiting for a machine translation of its description. */
export type TranslationCandidate = {
  id: number;
  username: string;
  description: string;
  lang: string | null;
  descriptionZh: string | null;
  descriptionEn: string | null;
};

/**
 * Approved entries whose description has no current translation: never translated, translated
 * before the description last changed, or stamped in the future (a clock skew would otherwise
 * freeze the entry forever). Oldest attempt first, so nothing starves.
 */
export function listEntriesNeedingTranslation(
  db: Db,
  limit: number,
  now: number,
): Promise<TranslationCandidate[]> {
  const take = Math.max(0, Math.min(Math.trunc(limit) || 0, 50));
  if (take === 0) return Promise.resolve([]);
  return db
    .select({
      id: entries.id,
      username: entries.username,
      description: entries.description,
      lang: entries.lang,
      descriptionZh: entries.descriptionZh,
      descriptionEn: entries.descriptionEn,
    })
    .from(entries)
    .where(
      and(
        eq(entries.status, "approved"),
        ne(entries.description, ""),
        or(
          isNull(entries.descriptionTranslatedAt),
          sql`${entries.descriptionTranslatedAt} < ${entries.updatedAt}`,
          sql`${entries.descriptionTranslatedAt} > ${now}`,
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(${entries.descriptionTranslatedAt}, 0)`), asc(entries.id))
    .limit(take);
}

/**
 * Stores one direction of a description translation and stamps the attempt. The stamp always
 * changes, so this always costs a row — that is what keeps the entry out of the next batch.
 */
export async function setEntryTranslation(
  db: Db,
  input: { entryId: number; locale: Locale; text: string; now: number },
) {
  const column = input.locale === "en" ? "descriptionEn" : "descriptionZh";
  const result = await db
    .update(entries)
    .set({ [column]: input.text, descriptionTranslatedAt: input.now })
    .where(eq(entries.id, input.entryId))
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Records a translation attempt that produced nothing (description too short or too long, or the
 * model failed for good), so the entry isn't retried on every run. `updated_at` is untouched, so
 * the next real description change puts it back in the queue.
 */
export async function stampTranslationSkipped(db: Db, entryId: number, now: number) {
  const result = await db
    .update(entries)
    .set({ descriptionTranslatedAt: now })
    .where(eq(entries.id, entryId))
    .run();
  return { rowsWritten: result.meta.rows_written };
}
