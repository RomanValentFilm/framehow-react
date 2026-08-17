-- WHEN a frame or a version was actually changed, as opposed to when it was
-- sent.
--
-- Frames and versions already carry `updated_at`, but the app sets that to the
-- moment of the PUSH. So two devices editing the same frame offline arrive with
-- `updated_at` in the order they reconnected, and the server cannot tell which
-- edit was made first. "Newer wins" compared push times and therefore meant
-- "last to reconnect wins" — the desktop overwriting an iPad change that was
-- half an hour more recent.
--
-- The per-frame stamp added last week answers a different question: it records
-- what the device believed the SERVER's version of the frame was, which is how
-- we notice a frame moved underneath someone and raise the picker. Right
-- granularity, wrong fact.
--
-- This is the missing fact, and it is the same one that made settings items
-- behave: stamped when the change is seen locally, so it survives being
-- offline and orders two edits honestly.
--
-- NULL means an older client, or a row written before this existed. The server
-- falls back to updated_at in that case, which is no worse than today.
--
-- NOTE TO SELF: never edit this file once it has been run.

ALTER TABLE frames   ADD COLUMN content_changed_at INTEGER;
ALTER TABLE versions ADD COLUMN content_changed_at INTEGER;
