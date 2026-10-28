-- DELETED PICTURES (28 October, Roman: the PICTS library's DELETE).
--
-- A picture deleted in the library is gone from storage for good; the card it
-- was on stays, with its drawings and text, and says "You deleted this picture".
--
--   images.deleted_at   the card's picture row stays, marked — so every device
--                       that pulls learns the card's picture was deleted
--   deleted_pictures    the server's memory of every deleted file, so a device
--                       that was offline at the time can never put it back
ALTER TABLE images ADD COLUMN deleted_at INTEGER;
CREATE TABLE IF NOT EXISTS deleted_pictures (
  r2_key     TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_pictures_user ON deleted_pictures(user_id, deleted_at);
