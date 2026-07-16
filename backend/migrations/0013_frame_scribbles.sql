-- Scribble strokes drawn over each frame in 3×2 view.
-- Stored as JSON array of Stroke objects. NULL means no scribbles.
ALTER TABLE frames ADD COLUMN scribbles TEXT;
