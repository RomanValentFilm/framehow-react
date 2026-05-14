-- Track which device last synced each project, so the client can warn
-- about potential conflicts when a different device has unsynced local work.

ALTER TABLE projects ADD COLUMN last_device_id TEXT;
ALTER TABLE projects ADD COLUMN last_device_name TEXT;
