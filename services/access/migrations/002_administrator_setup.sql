-- Up Migration
ALTER TABLE clawscarf_access.server
 ADD COLUMN setup_complete boolean NOT NULL DEFAULT true,
 ADD COLUMN setup_token_hash text,
 ADD COLUMN setup_expires_at timestamptz,
 ADD COLUMN setup_subject text;
ALTER TABLE clawscarf_access.browser_sessions DROP CONSTRAINT browser_sessions_purpose_check;
ALTER TABLE clawscarf_access.browser_sessions ADD CONSTRAINT browser_sessions_purpose_check
 CHECK (purpose IN ('browser','management','enrollment','setup'));
-- Down Migration
DELETE FROM clawscarf_access.browser_sessions WHERE purpose='setup';
ALTER TABLE clawscarf_access.browser_sessions DROP CONSTRAINT browser_sessions_purpose_check;
ALTER TABLE clawscarf_access.browser_sessions ADD CONSTRAINT browser_sessions_purpose_check
 CHECK (purpose IN ('browser','management','enrollment'));
ALTER TABLE clawscarf_access.server DROP COLUMN setup_complete,
 DROP COLUMN setup_token_hash, DROP COLUMN setup_expires_at, DROP COLUMN setup_subject;
