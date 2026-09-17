-- Up Migration
ALTER TABLE clawscarf_access.local_tokens ADD COLUMN consumed_at timestamptz;
-- Down Migration
DELETE FROM clawscarf_access.local_tokens WHERE consumed_at IS NOT NULL;
ALTER TABLE clawscarf_access.local_tokens DROP COLUMN consumed_at;
