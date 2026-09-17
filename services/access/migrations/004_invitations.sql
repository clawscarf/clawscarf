-- Up Migration
CREATE TABLE clawscarf_access.invitations (
 id uuid PRIMARY KEY,
 token_hash text NOT NULL UNIQUE,
 email text NOT NULL,
 sponsor_id uuid NOT NULL REFERENCES clawscarf_access.users(id),
 sponsor_revision bigint NOT NULL,
 subject text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 accepted_at timestamptz,
 revoked_at timestamptz
);
ALTER TABLE clawscarf_access.browser_sessions DROP CONSTRAINT browser_sessions_purpose_check;
ALTER TABLE clawscarf_access.browser_sessions ADD CONSTRAINT browser_sessions_purpose_check
 CHECK(purpose IN ('browser','management','enrollment','setup','invitation'));
-- Down Migration
DELETE FROM clawscarf_access.browser_sessions WHERE purpose='invitation';
ALTER TABLE clawscarf_access.browser_sessions DROP CONSTRAINT browser_sessions_purpose_check;
ALTER TABLE clawscarf_access.browser_sessions ADD CONSTRAINT browser_sessions_purpose_check
 CHECK(purpose IN ('browser','management','enrollment','setup'));
DROP TABLE clawscarf_access.invitations;
