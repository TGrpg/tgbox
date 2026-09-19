import { type SiteLocale, siteLocales } from "@tgbox/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { userPrefs } from "./schema.ts";

/** The user's chosen bot language, or null to follow their Telegram client language. */
export async function getUserLocale(db: Db, tgUserId: number): Promise<SiteLocale | null> {
  const [row] = await db
    .select({ locale: userPrefs.locale })
    .from(userPrefs)
    .where(eq(userPrefs.tgUserId, tgUserId));
  // The column is plain text; a value written by an older/other version must not break the update.
  return siteLocales.find((locale) => locale === row?.locale) ?? null;
}

/** Conditional upsert: 0 rows written when the stored locale is unchanged. */
export async function setUserLocale(db: Db, tgUserId: number, locale: SiteLocale, now: number) {
  const result = await db
    .insert(userPrefs)
    .values({ tgUserId, locale, updatedAt: now })
    .onConflictDoUpdate({
      target: userPrefs.tgUserId,
      set: { locale: sql`excluded.locale`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`${userPrefs.locale} IS NOT excluded.locale`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/** Back to "auto": the language heuristic applies again. */
export async function clearUserLocale(db: Db, tgUserId: number) {
  const result = await db.delete(userPrefs).where(eq(userPrefs.tgUserId, tgUserId)).run();
  return { rowsWritten: result.meta.rows_written };
}
