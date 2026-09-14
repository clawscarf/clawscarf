-- Up Migration
CREATE SCHEMA clawscarf_connections;
SET LOCAL search_path TO clawscarf_connections, pg_catalog;
CREATE TABLE connections (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL,
  connector_id text NOT NULL CHECK(length(connector_id) BETWEEN 1 AND 100),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160 AND name=btrim(name)),
  grant_policy jsonb NOT NULL CHECK(jsonb_typeof(grant_policy)='object' AND grant_policy->>'mode' IN ('all','selected')),
  state text NOT NULL CHECK(state IN ('not_connected','connected','needs_attention','disconnected')),
  generation integer NOT NULL CHECK(generation>0),
  revision integer NOT NULL CHECK(revision>0),
  active_account_id uuid,
  failure jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(server_id,id),
  CHECK(state<>'connected' OR active_account_id IS NOT NULL),
  CHECK(state<>'disconnected' OR active_account_id IS NULL)
);
CREATE INDEX connections_page ON connections(server_id,id);
CREATE TABLE connection_setups (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  initiator_id uuid NOT NULL,
  actor jsonb NOT NULL CHECK(jsonb_typeof(actor)='object' AND actor->>'userId'=initiator_id::text),
  session_hash text NOT NULL,
  subject_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('initial','reconnect')),
  state text NOT NULL CHECK(state IN ('creating','pending','verifying','succeeded','expired','cancelled','failed','outcome_unknown')),
  account_id uuid,
  sealed_url text,
  allocation_dispatched_at timestamptz,
  preparation_dispatched_at timestamptz,
  preparation_catalog_version text CHECK(preparation_catalog_version ~ '^sha256:[a-f0-9]{64}$'),
  prepared_auth jsonb,
  CONSTRAINT connection_setups_preparation_pair CHECK((preparation_dispatched_at IS NULL)=(preparation_catalog_version IS NULL)),
  CONSTRAINT connection_setups_prepared_auth CHECK(prepared_auth IS NULL OR (
    preparation_dispatched_at IS NOT NULL
    AND jsonb_typeof(prepared_auth)='object'
    AND prepared_auth ?& ARRAY['id','toolkit']
    AND prepared_auth-ARRAY['id','toolkit']='{}'::jsonb
    AND jsonb_typeof(prepared_auth->'id')='string'
    AND jsonb_typeof(prepared_auth->'toolkit')='string'
    AND char_length(prepared_auth->>'id') BETWEEN 1 AND 4096
    AND char_length(prepared_auth->>'toolkit') BETWEEN 1 AND 4096
    AND prepared_auth->>'id'=btrim(prepared_auth->>'id')
    AND prepared_auth->>'toolkit'=btrim(prepared_auth->>'toolkit')
  )),

  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure jsonb,
  FOREIGN KEY(server_id,connection_id) REFERENCES connections(server_id,id),
  UNIQUE(server_id,connection_id,id),
  CHECK(state<>'pending' OR (account_id IS NOT NULL AND sealed_url IS NOT NULL)),
  CHECK(state NOT IN ('creating','pending','verifying') OR completed_at IS NULL)
);
CREATE UNIQUE INDEX connection_one_pending_setup ON connection_setups(connection_id) WHERE state IN ('creating','pending','verifying');
CREATE INDEX connection_setups_initiator ON connection_setups(initiator_id,project_id) WHERE state IN ('creating','pending','verifying');
CREATE INDEX connection_setups_due ON connection_setups(expires_at) WHERE state IN ('creating','pending','verifying');
CREATE TABLE connection_accounts (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  setup_id uuid NOT NULL,
  project_id text NOT NULL,
  provider_account_id text NOT NULL,
  subject_id text NOT NULL,
  toolkit text NOT NULL,
  auth_configuration_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('candidate','active','cleanup')),
  cleanup text NOT NULL CHECK(cleanup IN ('none','pending','running','complete','needs_attention')),
  revocation_job_id text,
  failure jsonb,
  next_attempt_at timestamptz,
  UNIQUE(project_id,provider_account_id),
  UNIQUE(server_id,connection_id,id),
  FOREIGN KEY(server_id,connection_id,setup_id) REFERENCES connection_setups(server_id,connection_id,id),
  CHECK((state='cleanup')=(cleanup<>'none'))
);
CREATE UNIQUE INDEX connection_one_active_account ON connection_accounts(connection_id) WHERE state='active';
CREATE INDEX connection_accounts_cleanup ON connection_accounts(next_attempt_at) WHERE cleanup IN ('pending','running');
ALTER TABLE connections ADD FOREIGN KEY(server_id,id,active_account_id) REFERENCES connection_accounts(server_id,connection_id,id);
ALTER TABLE connection_setups ADD FOREIGN KEY(server_id,connection_id,account_id) REFERENCES connection_accounts(server_id,connection_id,id);
CREATE TABLE connection_commands (
  server_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
  fingerprint text NOT NULL,
  resource_id uuid NOT NULL,
  PRIMARY KEY(server_id,actor_id,key)
);
CREATE TABLE connection_credentials (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL,
  generation integer NOT NULL CHECK(generation>0),
  hash text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('active','revoked')),
  UNIQUE(server_id,generation)
);
CREATE UNIQUE INDEX connection_one_active_credential ON connection_credentials(server_id) WHERE state='active';
CREATE TABLE connection_invocations (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  generation integer NOT NULL CHECK(generation>0),
  credential_id uuid NOT NULL REFERENCES connection_credentials(id),
  credential_generation integer NOT NULL CHECK(credential_generation>0),
  account_id uuid NOT NULL,
  agent_id text NOT NULL,
  correlation text NOT NULL,
  fingerprint text NOT NULL,
  action_id text NOT NULL,
  version text NOT NULL,
  state text NOT NULL CHECK(state IN ('dispatching','succeeded','rejected','outcome_unknown')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure jsonb,
  sealed_result text,
  sealed_result_manifest text,
  result_unavailable text,
  UNIQUE(server_id,correlation),
  FOREIGN KEY(server_id,connection_id,account_id) REFERENCES connection_accounts(server_id,connection_id,id),
  CONSTRAINT connection_invocations_result_storage_check CHECK(num_nonnulls(sealed_result,sealed_result_manifest,result_unavailable)=1),
  CONSTRAINT connection_invocations_result_retention_check CHECK(result_unavailable IN ('pending','failed','outcome_unknown','invalid_result','expired')),
  CONSTRAINT connection_invocations_result_success_check CHECK(state='succeeded' OR (sealed_result IS NULL AND sealed_result_manifest IS NULL)),
  CHECK((state='dispatching')=(completed_at IS NULL))
);
CREATE INDEX connection_invocations_dispatch ON connection_invocations(created_at) WHERE state='dispatching';
CREATE TABLE connection_callbacks (
  hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  connection_id uuid REFERENCES connections(id),
  state text NOT NULL CHECK(state IN ('verifying','complete')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE connection_result_pages (
  invocation_id uuid NOT NULL,
  page_number integer NOT NULL,
  sealed_page text NOT NULL,
  CONSTRAINT connection_result_pages_invocation_fkey
    FOREIGN KEY(invocation_id) REFERENCES connection_invocations(id) ON DELETE CASCADE,
  CONSTRAINT connection_result_pages_number_check CHECK(page_number>=0 AND page_number<1025),
  CONSTRAINT connection_result_pages_payload_check CHECK(octet_length(sealed_page) BETWEEN 1 AND 65536),
  CONSTRAINT connection_result_pages_pkey PRIMARY KEY(invocation_id,page_number)
);

CREATE INDEX connection_invocations_result_retention
  ON connection_invocations(completed_at,id)
  WHERE sealed_result IS NOT NULL OR sealed_result_manifest IS NOT NULL;

CREATE TABLE connection_callback_receipts (
  callback_hash text PRIMARY KEY REFERENCES connection_callbacks(hash),
  project_id text NOT NULL CHECK(octet_length(project_id) BETWEEN 1 AND 4096 AND project_id=btrim(project_id)),
  subject_id text NOT NULL CHECK(octet_length(subject_id) BETWEEN 1 AND 4096 AND subject_id=btrim(subject_id)),
  provider_account_id text NOT NULL CHECK(octet_length(provider_account_id) BETWEEN 1 AND 4096 AND provider_account_id=btrim(provider_account_id)),
  toolkit text NOT NULL CHECK(octet_length(toolkit) BETWEEN 1 AND 4096 AND toolkit=btrim(toolkit))
);

CREATE INDEX connection_callback_receipts_account
  ON connection_callback_receipts USING hash(provider_account_id);

CREATE TABLE connection_returns (
  id uuid PRIMARY KEY,
  cookie_hash text NOT NULL CHECK(cookie_hash ~ '^[0-9a-f]{64}$'),
  session_hash text NOT NULL CHECK(session_hash ~ '^[0-9a-f]{64}$'),
  sealed_session text NOT NULL CHECK(octet_length(sealed_session) BETWEEN 1 AND 65536),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '10 minutes',
  CONSTRAINT connection_returns_lifetime CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  UNIQUE(cookie_hash,session_hash)
);

CREATE INDEX connection_returns_expiry ON connection_returns(expires_at);

CREATE FUNCTION connection_catalog_valid_bindings(bindings jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(bindings)='array' THEN
    jsonb_array_length(bindings)<=2000
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(bindings) AS element(binding)
      WHERE NOT COALESCE(CASE WHEN jsonb_typeof(binding)='object' THEN
        binding ?& ARRAY['id','toolkit']
        AND binding-ARRAY['id','toolkit']='{}'::jsonb
        AND jsonb_typeof(binding->'id')='string'
        AND jsonb_typeof(binding->'toolkit')='string'
        AND binding->>'id' ~ '^[a-z][a-z0-9_]{0,99}$'
        AND binding->>'toolkit' ~ '^[a-z][a-z0-9_]{0,99}$'
      ELSE false END,false)
    )
    AND jsonb_array_length(bindings)=(SELECT count(DISTINCT binding->>'id') FROM jsonb_array_elements(bindings) AS element(binding))
    AND jsonb_array_length(bindings)=(SELECT count(DISTINCT binding->>'toolkit') FROM jsonb_array_elements(bindings) AS element(binding))
  ELSE false END
$$;

CREATE TABLE connection_catalog_publication (
  singleton integer PRIMARY KEY CHECK(singleton=1),
  version text CHECK(version ~ '^sha256:[a-f0-9]{64}$'),
  connectors jsonb NOT NULL CHECK(connection_catalog_valid_bindings(connectors)),
  CONSTRAINT connection_catalog_publication_unpublished CHECK(version IS NOT NULL OR connectors='[]'::jsonb)
);
INSERT INTO connection_catalog_publication(singleton,version,connectors) VALUES(1,NULL,'[]'::jsonb);


CREATE INDEX connections_connector ON connections(connector_id,id);
CREATE INDEX connection_accounts_catalog ON connection_accounts(connection_id,id)
  WHERE state IN ('candidate','active') OR cleanup IN ('pending','running','needs_attention');
CREATE INDEX connection_setups_catalog ON connection_setups(connection_id,id)
  WHERE state IN ('creating','pending','verifying','outcome_unknown')
    OR (allocation_dispatched_at IS NOT NULL AND account_id IS NULL)
    OR (preparation_dispatched_at IS NOT NULL AND prepared_auth IS NULL);
CREATE INDEX connection_invocations_catalog ON connection_invocations(connection_id,id) WHERE state='dispatching';

-- Down Migration
DROP SCHEMA clawscarf_connections CASCADE;
