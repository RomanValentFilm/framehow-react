-- Device heartbeat: tracks which device is actively working on a project.
-- All timestamps are server-side (no client clock dependency).
ALTER TABLE projects ADD COLUMN heartbeat_at INTEGER;
ALTER TABLE projects ADD COLUMN heartbeat_device_id TEXT;
ALTER TABLE projects ADD COLUMN heartbeat_device_name TEXT;
