-- RATE LIMITS (audit 9 Nov, B3d). One row per (door, who, window): how many
-- times a door was knocked on in the current window. Swept nightly.
CREATE TABLE IF NOT EXISTS rate_hits (
  k TEXT PRIMARY KEY,          -- "<door>:<who>" e.g. "login:roman@…", "signup:ip:1.2.3.4"
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL
);
