-- Project snapshots for the Restore feature.
-- Each snapshot stores a full JSON copy of the project tree at a point in time.
-- The backend saves one every ~10 minutes during active pushes and thins old
-- ones according to the retention policy:
--   Last hour:    every 10 min (5 max)
--   1–4 hours:    one per hour (3 max)
--   5–24 hours:   one per 4 hours (2 max)
--   Older than 24h: one ("yesterday")
-- Max ~11 snapshots per project.

CREATE TABLE IF NOT EXISTS project_snapshots (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Full project tree as JSON (strips, frames, versions, images refs, drawings, metadata).
  -- Does NOT include the actual image bytes — those stay in R2 referenced by r2_key.
  tree_json  TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project_time
  ON project_snapshots(project_id, created_at);
