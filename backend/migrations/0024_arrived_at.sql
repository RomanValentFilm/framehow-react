-- ONE CLOCK FOR "WHAT HAVE I NOT BEEN TOLD YET" (#316).
--
-- A device catches up by asking: give me everything since X. X is a time the
-- server gave it. So every row the answer is filtered on has to be stamped by
-- the SERVER, or the question is comparing two different clocks and the answer
-- is wrong in a way nobody can see.
--
-- #313 fixed that for frames, versions, images and drawings. These two tables
-- were missed, and they were the two where it hurt most, because both hold work
-- made while a device is away — which is exactly when the clocks are furthest
-- apart:
--
--   project_settings.changed_at   -- the DEVICE's clock
--   project_deletions.deleted_at  -- the DEVICE's clock
--
-- What went wrong. Rename a needs category on the iPad on Monday, offline. The
-- iPad reconnects on Wednesday. The desktop last pulled on Tuesday, so it asks
-- for everything since Tuesday. The rename is stamped Monday. Monday is not
-- after Tuesday, so it is never handed over — not late, invisible, and for good,
-- because that watermark only ever climbs.
--
-- Deletions were worse. The tombstone never arrives, so the frame lives on on
-- the other device; and every edit made to it there is thrown away in silence by
-- the "dead stay dead" filter, with the push answering 200 and writing nothing.
-- A frame that quietly refuses to sync, for ever.
--
-- This adds the missing column: when the row REACHED here, by this machine's
-- clock, which is the same clock projects.updated_at has always used.
--
-- What is NOT changing: changed_at and deleted_at stay exactly as they are —
-- the device's honest answer to "when did a person do this". That is what
-- decides who is RIGHT. arrived_at only decides who still needs TELLING. Two
-- questions, two columns, and no comparing across them.
--
-- Rows written before today have no arrived_at. The delta reads
-- COALESCE(arrived_at, changed_at), so they behave exactly as they do now —
-- nothing that works today stops working, and every row written from now on is
-- deliverable.
--
-- NOTE TO SELF: never edit this file once it has been run.

ALTER TABLE project_settings  ADD COLUMN arrived_at INTEGER;
ALTER TABLE project_deletions ADD COLUMN arrived_at INTEGER;

-- The delta filters on these on every pull.
CREATE INDEX IF NOT EXISTS idx_project_settings_arrived
  ON project_settings(project_id, arrived_at);
CREATE INDEX IF NOT EXISTS idx_project_deletions_arrived
  ON project_deletions(project_id, arrived_at);
