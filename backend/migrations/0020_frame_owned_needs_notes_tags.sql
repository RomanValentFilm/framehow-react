-- Needs, notes, setup and tags belong to the frame (or the version), not to a
-- project-wide list keyed by id.
--
-- Until now they lived in the project's metadata blob, which every push
-- replaces whole. So the last device to push owned EVERY frame's needs, and a
-- different push owned every frame's notes — one device's notes sitting beside
-- another's needs. Nothing about that list is per-frame, so the conflict
-- machinery never saw it, and a frame created by KEEP BOTH had no entry at all.
--
-- The client already treats needs and notes as part of the frame: its
-- fingerprint for "has this frame changed" includes them. Only the storage
-- disagreed. This finishes that.
--
-- No backfill: there are no users yet, and each device still holds its own copy
-- locally, so the first push after the client change writes these columns from
-- what is already on the device.
--
-- NOTE TO SELF: never edit this file once it has been run. A re-run skips
-- statements that already applied and the columns silently go missing — that
-- cost us migration 0019.

ALTER TABLE frames   ADD COLUMN needs    TEXT;   -- JSON: this frame's need state
ALTER TABLE frames   ADD COLUMN notes    TEXT;   -- JSON: this frame's note state
ALTER TABLE frames   ADD COLUMN setup_id TEXT;   -- which setup this frame uses
ALTER TABLE versions ADD COLUMN tags     TEXT;   -- JSON: this version's tags
