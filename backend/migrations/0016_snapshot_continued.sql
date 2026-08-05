-- When the user restored to this point and then carried on working from it.
-- The snapshot itself is untouched; this only records that the story continued.
ALTER TABLE project_snapshots ADD COLUMN continued_at INTEGER;
