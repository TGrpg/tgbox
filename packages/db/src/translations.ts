import type { Locale } from "@tgbox/shared";
import { and, asc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
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
 * Approved entries whose description has no current translation: never attempted (a description
 * change resets the stamp, in `updateEntryCold`), last attempt failed (a negative stamp), or
 * stamped in the future (a clock skew would otherwise freeze the entry forever). Other edits — a
 * new title or avatar — leave the stamp alone, so they never queue an entry, skipped ones
 * included. Ordered by when the entry was last tried, never-tried first, so an entry that keeps
 * failing goes to the back instead of holding the head of every batch.
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
          lt(entries.descriptionTranslatedAt, 0),
          sql`${entries.descriptionTranslatedAt} > ${now}`,
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(abs(${entries.descriptionTranslatedAt}), 0)`), asc(entries.id))
    .limit(take);
}

/**
 * Every outcome below is written only while the entry still has the description that was sent to
 * the model: an edit that landed meanwhile already reset the stamp and dropped the translations,
 * and a late result for the old text must not undo that.
 */
const sameSource = (entryId: number, description: string) =>
  and(eq(entries.id, entryId), eq(entries.description, description));

/**
 * Stores one direction of a description translation and stamps the attempt. The stamp always
 * changes, so this costs a row — that is what keeps the entry out of the next batch. Writes
 * nothing (`rowsWritten: 0`) when the description changed in the meantime.
 */
export async function setEntryTranslation(
  db: Db,
  input: { entryId: number; description: string; locale: Locale; text: string; now: number },
) {
  const column = input.locale === "en" ? "descriptionEn" : "descriptionZh";
  const result = await db
    .update(entries)
    .set({ [column]: input.text, descriptionTranslatedAt: input.now })
    .where(sameSource(input.entryId, input.description))
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Records a model failure as a negative stamp: the entry stays queued, behind everything tried
 * longer ago, so a description the model keeps failing on can't block the rest of the queue.
 */
export async function stampTranslationFailed(
  db: Db,
  input: { entryId: number; description: string; now: number },
) {
  const result = await db
    .update(entries)
    .set({ descriptionTranslatedAt: -input.now })
    .where(sameSource(input.entryId, input.description))
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/**
 * Records a translation attempt that produced nothing (description too short or too long), so the
 * entry isn't retried on every run. The next description change resets the stamp and puts it back
 * in the queue.
 */
export async function stampTranslationSkipped(
  db: Db,
  input: { entryId: number; description: string; now: number },
) {
  const result = await db
    .update(entries)
    .set({ descriptionTranslatedAt: input.now })
    .where(sameSource(input.entryId, input.description))
    .run();
  return { rowsWritten: result.meta.rows_written };
}
