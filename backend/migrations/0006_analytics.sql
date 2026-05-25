-- Analytics: track user journeys, feature usage, sessions.
-- All timestamps are unix-epoch milliseconds (INTEGER), matching the rest of the schema.

-- Every action a user takes in the app. One row per event.
-- uid is nullable (user might not be logged in yet — e.g. landing page, first app open).
CREATE TABLE analytics_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,           -- when it happened (epoch ms)
  event    TEXT    NOT NULL,           -- event name: 'app_opened', 'draw_used', etc.
  uid      TEXT,                       -- user id (null if not logged in)
  sid      TEXT    NOT NULL,           -- session id (random per browser session)
  device   TEXT,                       -- 'phone' | 'tablet' | 'desktop'
  browser  TEXT,                       -- 'safari' | 'chrome' | 'firefox' | 'other'
  pwa      INTEGER NOT NULL DEFAULT 0, -- 1 if running as PWA
  country  TEXT,                       -- ISO 2-letter code from Cloudflare
  meta     TEXT                        -- JSON blob for event-specific data
);

CREATE INDEX idx_ae_ts      ON analytics_events(ts);
CREATE INDEX idx_ae_uid     ON analytics_events(uid) WHERE uid IS NOT NULL;
CREATE INDEX idx_ae_sid     ON analytics_events(sid);
CREATE INDEX idx_ae_event   ON analytics_events(event);

-- One row per session. Updated on each heartbeat so we know duration.
CREATE TABLE analytics_sessions (
  sid        TEXT    PRIMARY KEY,       -- session id
  uid        TEXT,                      -- user id (set when they log in)
  device     TEXT,
  browser    TEXT,
  pwa        INTEGER NOT NULL DEFAULT 0,
  country    TEXT,
  started_at INTEGER NOT NULL,         -- first event timestamp
  last_seen  INTEGER NOT NULL,         -- last heartbeat / event timestamp
  events     INTEGER NOT NULL DEFAULT 0 -- count of events in this session
);

CREATE INDEX idx_as_uid ON analytics_sessions(uid) WHERE uid IS NOT NULL;
CREATE INDEX idx_as_started ON analytics_sessions(started_at);
