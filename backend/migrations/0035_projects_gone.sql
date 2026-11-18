-- PROJECTS DELETED FOR GOOD (18 November, Roman: WF 7 was deleted with Delete
-- now, and a browser that still had it open was never told).
--
-- A project deleted for good leaves no row behind, so a device still holding it
-- got a plain "not found" — which the app must never read as "you deleted it"
-- (#465). This is the server's small memory of it: the id, whose it was, when.
-- With it the answer is 410 "deleted", the same as for a project in the
-- recover list, and the device is told.
CREATE TABLE IF NOT EXISTS projects_gone (
  project_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  gone_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_gone_user ON projects_gone(user_id);
