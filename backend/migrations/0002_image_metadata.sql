-- Image metadata needed for serving and quota enforcement.
-- size_bytes:    enforce per-account 350 MB limit (sum across user's images)
-- content_type:  serve with correct MIME without re-sniffing
-- created_at:    rate-limit signal (e.g. 400 uploads/hour) and audit

ALTER TABLE images ADD COLUMN size_bytes   INTEGER;
ALTER TABLE images ADD COLUMN content_type TEXT;
ALTER TABLE images ADD COLUMN created_at   INTEGER;

-- Helps the per-user storage-usage join used at sync-time quota checks.
CREATE INDEX idx_images_created_at ON images(created_at);
