-- UPDATE BY A DATE (19 November, list item 16b, agreed with Roman).
--
-- A user who is told "a new version is available" and says NOT NOW is told
-- once more two days later, with a date: fourteen days after the first card
-- the old version stops. Roman: the date is "per account" — the same on every
-- device of that person. So the moment of the first card is kept here.
--
--   update_clock_at       when the first card was shown (ms)
--   update_clock_version  the app version that device was running — a device
--                         on a NEWER version than this has not been told
--                         anything yet and starts its own count
ALTER TABLE users ADD COLUMN update_clock_at INTEGER;
ALTER TABLE users ADD COLUMN update_clock_version TEXT;
