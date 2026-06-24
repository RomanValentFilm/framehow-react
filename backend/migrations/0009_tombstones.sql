-- Tombstones: track explicit user deletions of frames and versions.
-- When a user deletes a frame or version on one device, the tombstone syncs
-- to other devices so they remove it too — instead of re-creating it.
-- Tombstones survive the full-replace push (applySync deletes children but
-- not tombstones). Cleaned up after 30 days by cron.
CREATE TABLE IF NOT EXISTS project_deletions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('frame', 'version')),
  entity_id  TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  device_id  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_deletions_project ON project_deletions(project_id);
CREATE INDEX IF NOT EXISTS idx_deletions_entity ON project_deletions(entity_id);
