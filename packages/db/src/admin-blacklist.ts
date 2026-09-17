import { desc } from "drizzle-orm";
import type { Db } from "./access.ts";
import { blacklist } from "./schema.ts";

/** Newest first. The blacklist is hand-maintained and small, so it is read whole. */
export function listBlacklist(db: Db) {
  return db.select().from(blacklist).orderBy(desc(blacklist.createdAt));
}
