-- Sync frame crop dimensions so version canvases render correctly cross-device.
-- crop_w / crop_h store the pixel dimensions of the frame's crop area.
-- NULL means "not yet set" (legacy frames before this migration).

ALTER TABLE frames ADD COLUMN crop_w INTEGER;
ALTER TABLE frames ADD COLUMN crop_h INTEGER;
