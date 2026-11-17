-- A description change now resets description_translated_at, and the translation queue no longer
-- compares it with updated_at. Entries whose description changed under the old rule (both
-- translations dropped, stamp older than the change) are requeued once here. Entries skipped as
-- too short or too long look the same; they are skipped again once and then stay out.
UPDATE entries SET description_translated_at = NULL
WHERE description_zh IS NULL
  AND description_en IS NULL
  AND description_translated_at > 0
  AND description_translated_at < updated_at;
