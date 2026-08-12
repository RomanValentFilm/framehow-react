-- A frame the server refused because it had changed elsewhere.
--
-- Until now a refusal was only a reply to one device's push: the losing version
-- existed nowhere but on the device that made it, so if that device was closed
-- the work could never be chosen again, and only that one device could answer
-- the question. Keeping it here makes the conflict something the project holds,
-- answerable from any device.
CREATE TABLE IF NOT EXISTS frame_conflicts (
  id           TEXT    PRIMARY KEY,
  project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frame_id     TEXT    NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  -- The version the server would not take, as the client sent it.
  losing_json  TEXT    NOT NULL,
  -- Who made each side, and when, so the picker can say "Keep Tablet's, made
  -- 13:55" rather than "keep mine" — which reads differently depending on
  -- which device is looking at it.
  device_name   TEXT,          -- the losing side
  made_at       INTEGER,       -- when the losing side was made
  winner_device TEXT,          -- the side already on the server
  winner_made_at INTEGER,
  -- Was the losing change made with no connection?
  made_offline INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  -- Null while the question is open. Set when somebody answers, which is also
  -- when the retention clock on the losing version starts.
  resolved_at  INTEGER,
  -- 'mine' | 'theirs' | 'both', recorded so a late second answer can be told
  -- what was already decided rather than silently doing nothing.
  resolution   TEXT
);

CREATE INDEX IF NOT EXISTS idx_frame_conflicts_open
  ON frame_conflicts(project_id, resolved_at);
