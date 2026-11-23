-- LAST USED (23 Nov 2026, Roman): "in the analytics i'd like to see last time
-- used… or online now". One date per account, stamped by the server whenever a
-- signed-in device talks to it (at most once in five minutes). Shown on the Storage
-- page; later it drives the "unused for 12 months" rule of the Terms.
-- NULL = no visit since this was built.
ALTER TABLE users ADD COLUMN last_used_at INTEGER;
