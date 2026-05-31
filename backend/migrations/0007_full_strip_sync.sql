-- Full strip sync: add columns the code already uses but were never migrated,
-- plus new columns for multi-strip sync, groups, and project metadata.

-- Frames: version_label (legacy ver-strip label), hidden flag, strip_labels JSON
ALTER TABLE frames ADD COLUMN version_label TEXT;
ALTER TABLE frames ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE frames ADD COLUMN strip_labels TEXT;

-- Versions: hidden and starred flags
ALTER TABLE versions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;

-- Projects: metadata JSON (stripDefs, groups, portraitMode)
ALTER TABLE projects ADD COLUMN metadata TEXT;
