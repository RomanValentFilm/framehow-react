-- starred column already exists on production (was added manually or by earlier deploy)
-- This migration is now a no-op to avoid "duplicate column" errors.
SELECT 1;
