-- Project settings, one row per item, each with its own time of change.
--
-- Until now every setting lived inside projects.metadata — a single text field
-- written whole. So the last device to PUSH won everything in it, including
-- changes it had never heard about and changes that were made earlier. Rename a
-- needs category on the iPad while offline, rename a setup on the desktop, and
-- one of the two is lost with no trace.
--
-- One row per item means the server can compare each item's own changed_at and
-- keep the newer, whoever pushes first.
--
-- kind + item_id together identify an item:
--   'group'            + the group's id
--   'sortOrder'        + the order's id            (its breaks ride inside it)
--   'needCategory'     + the category's id
--   'setupPalette'     + 'setupPalette'            (one item by agreement)
--   'storyFlowBreaks'  + 'storyFlowBreaks'         (story flow is not an order)
--
-- Camera aspect and export details stay in metadata on purpose — the user can
-- readjust those, and they are not work that can be lost.
--
-- A deleted item keeps its row with deleted_at set. Without that, a device that
-- never saw the deletion pushes the item back and it returns from the dead —
-- the same reason frames have tombstones.
--
-- NOTE TO SELF: never edit this file once it has been run.

CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  item_id    TEXT    NOT NULL,
  value      TEXT,                      -- JSON of the item; NULL when deleted
  changed_at INTEGER NOT NULL,          -- when the CHANGE was made, not when it was sent
  deleted_at INTEGER,
  PRIMARY KEY (project_id, kind, item_id)
);

CREATE INDEX IF NOT EXISTS idx_project_settings_project ON project_settings(project_id);
