-- The conflicts table was created before these columns existed, and
-- CREATE TABLE IF NOT EXISTS skips silently on a re-run — so the live table is
-- missing them. Add them here.
--
-- They let the picker name both sides properly ("Keep Tablet's, made 13:55")
-- instead of saying "mine" and "theirs", which read differently depending on
-- which device is looking at the question.
ALTER TABLE frame_conflicts ADD COLUMN made_at INTEGER;
ALTER TABLE frame_conflicts ADD COLUMN winner_device TEXT;
ALTER TABLE frame_conflicts ADD COLUMN winner_made_at INTEGER;
