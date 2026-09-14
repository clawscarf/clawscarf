-- Up Migration
CREATE SCHEMA clawscarf_access;
CREATE TABLE clawscarf_access.users (
 id uuid PRIMARY KEY,
 issuer text NOT NULL,
 subject text NOT NULL,
 email text NOT NULL,
 name text NOT NULL,
 admitted boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 UNIQUE(issuer,subject)
);
CREATE TABLE clawscarf_access.server (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 id uuid NOT NULL UNIQUE,
 administrator_id uuid NOT NULL REFERENCES clawscarf_access.users(id)
);
CREATE TABLE clawscarf_access.login_transactions (
 cookie_hash text PRIMARY KEY,
 state_hash text NOT NULL,
 payload text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE TABLE clawscarf_access.browser_sessions (
 hash text PRIMARY KEY,
 purpose text NOT NULL DEFAULT 'browser' CHECK(purpose IN ('browser','management','enrollment')),
 parent_hash text REFERENCES clawscarf_access.browser_sessions(hash) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES clawscarf_access.users(id),
 admission_revision bigint NOT NULL,
 csrf text NOT NULL,
 logout_redirect text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours'
);
CREATE TABLE clawscarf_access.local_tokens (
 hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
-- Down Migration
DROP SCHEMA clawscarf_access CASCADE;
