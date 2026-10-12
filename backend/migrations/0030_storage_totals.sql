-- RUNNING STORAGE TOTALS (12 October, Roman).
--
-- What the whole of Framehow holds at Cloudflare, and what each account holds,
-- kept as a running figure so the upload door can refuse in one cheap read
-- instead of listing the bucket on every picture. Scopes:
--
--   'all'          every file in the bucket
--   'user:<id>'    that account's files, orphans included (the 350 MB wall)
--   'alert:step'   the last storage step Roman was mailed about (bytes)
--
-- Uploads add, deletions subtract, and the nightly sweep lists the bucket and
-- writes the exact figures over whatever drift the day left behind.
CREATE TABLE IF NOT EXISTS storage_totals (
  scope      TEXT PRIMARY KEY,
  bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
