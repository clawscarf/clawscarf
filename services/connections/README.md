# Connections companion

Optional same-origin account management and tool broker for one ClawScarf server.
The [OpenClaw plugin](../../plugins/connections/README.md) exposes search, describe
and call tools; accounts, provider credentials, grants and receipts stay here.
[OpenAPI](openapi.json) owns the browser, CLI and plugin contract.

## Ownership and authority

The access companion supplies current sessions and a verifier that acts through
vanilla OpenClaw as the current person. Every account-management operation requires
native administrator authority. The native check runs before the short database
transaction; the transaction rechecks the session and proof before changing data.
The [native verifier](providers/authority.ts) owns the external authority check;
the [repository authority](repo/authority.ts) owns the SQL lock and transactional
checks. Both implement domain ports.
No organization, VM, host allocation or duplicate native-role database exists here.

Runtime credentials identify exactly this server and a generation. The broker
checks the current credential, exact connected account and agent grant for every
search, description, call and receipt read. Agent context comes from the plugin SDK;
this is one trusted team, not isolation from hostile administrators running code.
Credentials cannot authorize account management. Rotation revokes the preceding
credential immediately and returns the new token once. Upstream provider keys never
enter the plugin or browser.

Setup calls the provider directly after recording each external-effect intent.
There is no queue. Account creation, callback redemption and execution preserve
unknown outcomes and never automatically repeat uncertain effects. Opaque callbacks
are matched to the initiating person, current session, project and exact account.
Display names need not be unique. Disconnect removes local tool access immediately;
the maintenance sweep completes remote account cleanup. Result payloads are encrypted
and expire after 24 hours; execution receipts remain to prevent duplicate execution.

## Configuration and catalog

[The companion application](../../apps/companion/README.md) composes
[createConnectionsService](composition.ts). Its inputs are a Postgres pool, stable
server UUID, 32-byte encryption key, verified catalog, native identity port and a
dedicated Composio project/API key with callback URL. It rejects invalid enabled
configuration. The HTTP registration supports disabled capabilities without account
actions or provider calls. The application owns calling and stopping
`maintenance.sweep()`; it is unrelated to runtime provisioning or recovery.

The [manifest](catalog/manifest.json) contains all 44 selected donor connectors.
Generate provider-schema artifacts with the generic importer; add/remove services by
editing metadata and rerunning it, never by introducing provider-specific branches.
Downloaded schemas remain advisory. Generated catalogs belong in ignored artifacts.

From the repository root:

```sh
pnpm exec tsx services/connections/providers/catalog/import-command.ts refresh
pnpm exec tsx services/connections/providers/catalog/import-command.ts check
pnpm exec tsx services/connections/runtime/migrate.ts
pnpm exec tsx services/connections/catalog-command.ts publish \
  --catalog .local/connections/catalog --expected-version none
```

Import uses `CLAWSCARF_COMPOSIO_API_KEY` (or `--api-key-file`), migrations use the
separate `CLAWSCARF_MIGRATION_DATABASE_URL`, and catalog publication uses
`CLAWSCARF_DATABASE_URL`. SQL lives in its own `clawscarf_connections` schema;
migrations never run on API startup. Publication checks exact artifact versions and
blocks retirement while account/setup/invocation references require a connector.
Use the current published version instead of `none` for subsequent publication.

An administrator can rotate the plugin token through the generated REST client:

```sh
pnpm exec tsx services/connections/credential-command.ts \
  --origin https://team.example.com --session-file /private/session \
  rotate --output /private/connections-token
```

The session file contains the current `clawscarf_session` value. The CLI obtains
CSRF state through the access API; it does not bypass native administration. The
output file must not exist and is created with mode 0600. Mount that secret for the
plugin. Use `revoke` instead of `rotate` to disable its access. Never automatically
retry a lost rotation response; explicitly rotate again if the outcome is uncertain.

## Verification and reuse

[Tests](../../tests/connections/postgres.test.ts) cover the extracted generic provider contract,
exact-account search, encrypted result transport and real-Postgres account lifecycle,
idempotency, grants, credentials and session revocation. PostgreSQL tests require a
**disposable database** in `CLAWSCARF_CONNECTIONS_TEST_DATABASE_URL`; they recreate
only its Connections schema. Provider and native-authority effects in these tests
are controlled fixtures. This does not establish a live external-account journey.

Adapted from RawClaw commit
[f37a6e786fdd88857c21bd32140567874e281a8c](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/connections):
domain services/types/repos, generic Composio/catalog adapters, catalog importer,
connection forms and regressions. RawClaw's organization/admission/host policies and
plugin deployment operations are omitted; standalone access and explicit runtime
credentials replace those boundaries. The plugin wire protocol remains compatible.
See [third-party notices](../../THIRD_PARTY_NOTICES.md).
