-- Why a snapshot was taken.
--   'auto'        — the regular 10-minute safety snapshot
--   'pre_restore' — taken of the CURRENT state immediately before a restore,
--                   so the user can always get back to where they left off.
-- Existing rows are the automatic kind.
ALTER TABLE project_snapshots ADD COLUMN reason TEXT NOT NULL DEFAULT 'auto';
