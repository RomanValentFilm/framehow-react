-- Columns that exist on the live database but are in NO migration.
--
-- Some migrations say "column already exists on production. No-op." — they were
-- written after the column had been added by hand, so a database built from the
-- migrations alone is missing it. The bench applies this file afterwards to
-- match reality.
--
-- If something here ever turns out NOT to be on production, a push will fail
-- there and pass here, which is the worst way round. Anything added to this file
-- should be checked with:
--   npx wrangler d1 execute framehow-db --remote --command "PRAGMA table_info(projects);"

ALTER TABLE projects ADD COLUMN metadata TEXT;

-- 0007, 0007a, 0007b, 0007c, 0007e are all "already exists on production, no-op"
-- for the same reason. These are the columns they would have added.
ALTER TABLE frames   ADD COLUMN version_label TEXT;
ALTER TABLE frames   ADD COLUMN strip_labels  TEXT;
ALTER TABLE frames   ADD COLUMN hidden        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN hidden        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN starred       INTEGER NOT NULL DEFAULT 0;
