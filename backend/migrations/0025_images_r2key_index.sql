-- EVERY IMAGE LOAD WAS READING EVERY IMAGE ROW (#330).
--
-- upload.ts looks an image up by its storage key on every single fetch:
--
--   SELECT ... FROM images i ... WHERE i.r2_key = ? AND p.user_id = ?
--
-- `images` has an index on its own id, on version_id, and on created_at. None
-- on r2_key. So opening a storyboard of forty frames did forty scans of every
-- image row belonging to every user of the app — and it gets slower for
-- everyone, every day, as the table grows.
--
-- The cleanup job does the same lookup a hundred keys at a time.
--
-- Nothing changes in behaviour. It is the same answer, found without reading
-- the whole table to get it.
--
-- NOTE TO SELF: never edit this file once it has been run.

CREATE INDEX IF NOT EXISTS idx_images_r2_key ON images(r2_key);
