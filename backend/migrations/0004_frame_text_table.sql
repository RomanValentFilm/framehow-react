-- Sync frame text content and table data so they render cross-device.
-- text_content: free-form description text shown on the frame card.
-- table_data:   JSON-encoded table ({headers, rows}) shown on the frame card.
-- NULL means "not set" (most frames won't have these).

ALTER TABLE frames ADD COLUMN text_content TEXT;
ALTER TABLE frames ADD COLUMN table_data TEXT;
