import type { ActivityTier, EntryKind } from "../../packages/shared/src/index.ts";
import { sqlValue } from "../lib/sql.ts";

export type SeedRow = {
  username: string;
  kind: EntryKind;
  category: string;
  tags: string[];
  title: string;
  description: string;
  lang: string | null;
  verified: boolean;
  avatarVersion: string | null;
  tgCreatedAt: number | null;
  members: number | null;
  online: number | null;
  activityTier: ActivityTier | null;
};

/**
 * Idempotent SQL that lists one entry as approved (same rows as the bot's `insertApprovedEntry`).
 * Re-running refreshes cold fields and stats but keeps `listed_at` and the entry id.
 */
export function seedEntrySql(row: SeedRow, now: number) {
  const u = sqlValue(row.username.toLowerCase());
  const id = `(SELECT id FROM entries WHERE username = ${u})`;
  const v = sqlValue;
  return [
    `INSERT INTO entries (username, kind, category_id, title, description, lang, verified, avatar_version, tg_created_at, listed_at, status, updated_at)
SELECT ${u}, ${v(row.kind)}, c.id, ${v(row.title)}, ${v(row.description)}, ${v(row.lang)}, ${v(row.verified)}, ${v(row.avatarVersion)}, ${v(row.tgCreatedAt)}, ${now}, 'approved', ${now}
FROM categories c WHERE c.kind = ${v(row.kind)} AND c.slug = ${v(row.category)}
ON CONFLICT (username) DO UPDATE SET category_id = excluded.category_id, title = excluded.title, description = excluded.description,
  lang = coalesce(excluded.lang, entries.lang), verified = excluded.verified, avatar_version = excluded.avatar_version,
  tg_created_at = coalesce(entries.tg_created_at, excluded.tg_created_at), updated_at = excluded.updated_at
WHERE entries.category_id IS NOT excluded.category_id OR entries.title IS NOT excluded.title OR entries.description IS NOT excluded.description
  OR entries.verified IS NOT excluded.verified OR entries.avatar_version IS NOT excluded.avatar_version
  OR (excluded.lang IS NOT NULL AND entries.lang IS NOT excluded.lang) OR (entries.tg_created_at IS NULL AND excluded.tg_created_at IS NOT NULL);`,
    `INSERT INTO entry_stats (entry_id, members, online, activity_tier, stats_written_at)
SELECT ${id}, ${v(row.members)}, ${v(row.online)}, ${v(row.activityTier)}, ${now} WHERE ${id} IS NOT NULL
ON CONFLICT (entry_id) DO UPDATE SET members = excluded.members, online = excluded.online, activity_tier = excluded.activity_tier, stats_written_at = excluded.stats_written_at
WHERE entry_stats.members IS NOT excluded.members OR entry_stats.online IS NOT excluded.online OR entry_stats.activity_tier IS NOT excluded.activity_tier;`,
    `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ${id}, t.id FROM tags t WHERE t.slug IN (${row.tags.map(v).join(", ") || "NULL"});`,
    `DELETE FROM entries_fts WHERE rowid = ${id};`,
    `INSERT INTO entries_fts (rowid, title, username, tag_names)
SELECT e.id, e.title, e.username, coalesce((SELECT group_concat(t.name_zh || ' ' || t.name_en, ' ') FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id), '')
FROM entries e WHERE e.username = ${u};`,
  ].join("\n");
}

/** Marks the site dirty for the next build-deploy run (keeps an older mark). */
export function markDirtySql(now: number) {
  return `INSERT INTO site_state (key, value) VALUES ('dirty_since', '${now}') ON CONFLICT (key) DO NOTHING;`;
}
