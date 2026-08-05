-- Which snapshot the project was last restored to, so the restore list can
-- show the user where they currently stand.
ALTER TABLE projects ADD COLUMN restored_snapshot_id TEXT;
