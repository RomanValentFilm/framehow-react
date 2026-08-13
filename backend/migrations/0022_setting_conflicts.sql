-- A decision waiting on a project setting — in practice a SORT ORDER.
--
-- Settings merge on time of change, newer wins, and that is right for a name,
-- a colour or a category. A sort order is different: it is a long list of
-- frames that somebody arranged by hand. Taking the newer one silently throws
-- away the other arrangement, which is work, not a value.
--
-- So when two devices change the SAME order without either having seen the
-- other's version, the server keeps the losing side here and asks. Same rule
-- as a frame's picture: ask only where taking the newer destroys something.
--
-- The picker shows the order's NAME, the TIME it was changed and the DEVICE it
-- was changed on. Nothing else — an order is a long list and there is nothing
-- to eyeball.
--
-- Keeping both makes a copy called NAME#2.
--
-- NOTE TO SELF: never edit this file once it has been run.

CREATE TABLE IF NOT EXISTS setting_conflicts (
  id           TEXT    PRIMARY KEY,
  project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL,      -- 'sortOrder' today
  item_id      TEXT    NOT NULL,
  losing_json  TEXT    NOT NULL,      -- the version that was not applied
  device_name  TEXT,                  -- who made the losing side
  made_at      INTEGER,               -- when they made it
  winner_device    TEXT,              -- who made the side the server kept
  winner_made_at   INTEGER,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolution   TEXT                   -- 'mine' | 'theirs' | 'both'
);

CREATE INDEX IF NOT EXISTS idx_setting_conflicts_open
  ON setting_conflicts(project_id, resolved_at);
