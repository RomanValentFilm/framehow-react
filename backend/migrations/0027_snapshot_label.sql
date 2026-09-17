-- A restore point saved BY THE USER (#523): it carries a name and is kept for
-- ever, until the user deletes it. Everything else in the list is the app's.
ALTER TABLE project_snapshots ADD COLUMN label TEXT;
