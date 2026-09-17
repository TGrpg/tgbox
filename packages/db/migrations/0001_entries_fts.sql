-- Inline search index for the bot. rowid = entries.id; synced by the data-access layer
-- only when title/username/tags change (FTS5 has no conditional upsert).
CREATE VIRTUAL TABLE `entries_fts` USING fts5(title, username, tag_names, tokenize = 'trigram');
