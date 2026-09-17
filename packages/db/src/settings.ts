import type { SettingsKey } from "@tgbox/shared";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./access.ts";
import { botChats, credentials, settings } from "./schema.ts";

export type SettingsRow = typeof settings.$inferSelect;
export type CredentialKey = (typeof credentials.$inferSelect)["key"];
export type BotChat = typeof botChats.$inferSelect;

/* ---------------------------------------------------------------- settings */

/** All settings rows (raw JSON); callers parse them per key. */
export function listSettingsRows(db: Db) {
  return db.select().from(settings);
}

/** Conditional upsert: 0 rows written when the JSON value is unchanged. */
export async function upsertSetting(db: Db, key: SettingsKey, value: string, now: number) {
  const result = await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`${settings.value} IS NOT excluded.value`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/* ------------------------------------------------------------- credentials */

export async function getCredentialCiphertext(db: Db, key: CredentialKey) {
  const [row] = await db
    .select({ ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(eq(credentials.key, key));
  return row?.ciphertext;
}

export async function putCredentialCiphertext(
  db: Db,
  key: CredentialKey,
  ciphertext: string,
  now: number,
) {
  await db
    .insert(credentials)
    .values({ key, ciphertext, updatedAt: now })
    .onConflictDoUpdate({
      target: credentials.key,
      set: { ciphertext: sql`excluded.ciphertext`, updatedAt: sql`excluded.updated_at` },
    })
    .run();
}

/* --------------------------------------------------------------- bot chats */

/** Conditional upsert: 0 rows written when type, title, username and status are unchanged. */
export async function upsertBotChat(db: Db, chat: BotChat) {
  const result = await db
    .insert(botChats)
    .values(chat)
    .onConflictDoUpdate({
      target: botChats.chatId,
      set: {
        type: sql`excluded.type`,
        title: sql`excluded.title`,
        username: sql`excluded.username`,
        status: sql`excluded.status`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${botChats.type} IS NOT excluded.type OR ${botChats.title} IS NOT excluded.title OR ${botChats.username} IS NOT excluded.username OR ${botChats.status} IS NOT excluded.status`,
    })
    .run();
  return { rowsWritten: result.meta.rows_written };
}

/** Most recently changed first. */
export function listBotChats(db: Db) {
  return db.select().from(botChats).orderBy(desc(botChats.updatedAt));
}
