-- Nullable and opt-in: existing links keep their original behavior.
ALTER TABLE entries ADD COLUMN start_payload TEXT CONSTRAINT entries_start_payload_valid CHECK (
  start_payload IS NULL OR (kind = 'bot' AND length(start_payload) BETWEEN 1 AND 64
    AND instr(start_payload, char(0)) = 0 AND start_payload NOT GLOB '*[^A-Za-z0-9_-]*')
);
--> statement-breakpoint
ALTER TABLE submissions ADD COLUMN start_payload TEXT CONSTRAINT submissions_start_payload_valid CHECK (
  start_payload IS NULL OR (kind = 'bot' AND length(start_payload) BETWEEN 1 AND 64
    AND instr(start_payload, char(0)) = 0 AND start_payload NOT GLOB '*[^A-Za-z0-9_-]*')
);
