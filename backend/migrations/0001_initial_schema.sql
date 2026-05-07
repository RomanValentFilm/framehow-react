-- Framehow initial schema (see ACCOUNT_SYNC_SPEC.md "Database Schema").
-- All IDs are UUIDs (TEXT). All timestamps are unix-epoch milliseconds (INTEGER).
-- updated_at is used for last-write-wins sync.

-- ---------------------------------------------------------------------------
-- Users & Auth
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                            TEXT    PRIMARY KEY,
  name                          TEXT    NOT NULL,
  email                         TEXT    NOT NULL,
  password_hash                 TEXT    NOT NULL,
  profession                    TEXT,
  email_verified                INTEGER NOT NULL DEFAULT 0,
  -- Email verification: kept on the user row rather than a separate table to
  -- match the spec's minimal user-table footprint. Cleared on verify.
  email_verification_token_hash TEXT,
  email_verification_expires_at INTEGER,
  -- GDPR: account deletion is soft-delete; purger removes after grace period.
  deleted_at                    INTEGER,
  created_at                    INTEGER NOT NULL,
  updated_at                    INTEGER NOT NULL
);

-- Case-insensitive unique email (only for non-deleted accounts so a user can
-- re-register with the same email after deletion has finalized).
CREATE UNIQUE INDEX idx_users_email_active
  ON users(LOWER(email))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_users_email_verification_token_hash
  ON users(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

-- Sessions: server stores a hash of the token, never the token itself.
CREATE TABLE sessions (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Password reset: token stored as hash; single-use (used_at marks consumption).
CREATE TABLE password_resets (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_password_resets_user_id ON password_resets(user_id);

-- ---------------------------------------------------------------------------
-- Projects & Content
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  -- null = active, timestamp = soft-deleted (purged after 10 days by cron).
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_projects_user_active
  ON projects(user_id, updated_at)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_projects_deleted_at
  ON projects(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE strips (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_strips_project_order ON strips(project_id, sort_order);

CREATE TABLE frames (
  id         TEXT    PRIMARY KEY,
  strip_id   TEXT    NOT NULL REFERENCES strips(id) ON DELETE CASCADE,
  label      TEXT,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_frames_strip_order ON frames(strip_id, sort_order);

CREATE TABLE versions (
  id         TEXT    PRIMARY KEY,
  frame_id   TEXT    NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  label      TEXT,
  type       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_versions_frame ON versions(frame_id, updated_at);

-- One image per version (R2-backed). r2_key is the object key in IMAGES_BUCKET.
CREATE TABLE images (
  id         TEXT    PRIMARY KEY,
  version_id TEXT    NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
  r2_key     TEXT    NOT NULL,
  width      INTEGER,
  height     INTEGER,
  updated_at INTEGER NOT NULL
);

-- One drawing overlay per version. drawing_data is a JSON blob (TEXT in SQLite).
CREATE TABLE drawings (
  id           TEXT    PRIMARY KEY,
  version_id   TEXT    NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
  drawing_data TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Collaboration-ready (empty for now; spec: avoid restructuring later)
-- ---------------------------------------------------------------------------

CREATE TABLE project_members (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL,
  invited_at INTEGER NOT NULL,
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);
