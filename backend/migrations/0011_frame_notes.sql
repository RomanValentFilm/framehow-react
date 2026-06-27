-- Free-text note attached to each frame (shown via notepad icon on fullscreen canvas).
-- NULL means no note set.
ALTER TABLE frames ADD COLUMN note TEXT;
