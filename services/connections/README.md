# Connections companion

Optional same-origin account management and tool broker for one ClawScarf server.
The [OpenClaw plugin](../../plugins/connections/README.md) exposes search, describe
and call tools; accounts, provider credentials, grants and receipts stay here.
[OpenAPI](openapi.json) owns the browser, CLI and plugin contract. The plugin's
portable broker contract is generated from its bearer-authenticated runtime routes
and their referenced components; it is not a second authored contract. Regenerate
service clients with `pnpm connections:generate` and the portable contract/client
with `npm --prefix plugins/connections run api:generate`. `pnpm codegen:check`
checks both clients and the portable contract for drift.
All REST clients share the [generated HTTP transport](../../generated/README.md).

The [unified installation CLI](../../deploy/local/installation.md#connections)
can bootstrap local Connections on a fresh installation, including its initial scoped
runtime credential and native plugin settings. Offline bootstrap uses the repository
transaction and never replaces or reactivates existing credentials. External mode
accepts an existing scoped broker token; disabled mode creates no Connections schema.

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
migrations never run on API startup. [Schema readiness](repo/schema.ts) centrally
checks required columns, validated integrity constraints, ready indexes and the
catalog singleton before service startup or catalog publication. Publication checks exact artifact versions and
blocks retirement while account/setup/invocation references require a connector.
Use the current published version instead of `none` for subsequent publication.

An administrator can rotate the plugin token through the generated REST client:

```sh
pnpm exec tsx services/connections/credential-command.ts \
  --origin https://team.example.com --session-file /private/session \
  rotate --output /private/connections-token
```

The private, operator-owned session file contains the current `clawscarf_session` value. The CLI obtains
CSRF state through the access API; it does not bypass native administration. The
output file must not exist and is created with mode 0600. For local assembly, use
[stopped-runtime activation](../../deploy/local/README.md#activate-connections)
to supply it to the plugin. The CLI accepts an exact HTTPS origin or loopback HTTP
origin and follows no redirects. Use `revoke` instead of `rotate` to disable its access. Never automatically
retry a lost rotation response; explicitly rotate again if the outcome is uncertain.
The CLI emits no tokens in diagnostics. Its [transport regression](../../tests/connections/credential-command.test.ts)
checks private output, refusal before credential transmission and lost-response handling.

## Verification and reuse

[Tests](../../tests/connections/postgres.test.ts) cover the extracted generic provider contract,
exact-account search, encrypted result transport and real-Postgres account lifecycle,
idempotency, grants, credentials and session revocation. PostgreSQL tests require a
**disposable database** in `CLAWSCARF_CONNECTIONS_TEST_DATABASE_URL`; they recreate
only its Connections schema. The [lifecycle regressions](../../tests/connections/lifecycle.test.ts)
also create and remove uniquely named databases on that server, so their configured
login needs database-creation permission. They cover real HTTP request limits, concurrent setup-request replay,
cancellation during account allocation, uncertain allocation without duplicate
creation, setup cleanup and result expiry without losing invocation receipts.
Provider and native-authority effects in these tests are controlled fixtures.
The [dispatcher regressions](../../tests/connections/setup-dispatch.test.ts) also
exercise held allocations without PostgreSQL: repeated delivery observes the active
attempt, while expiry, revoked access and lost replies preserve uncertainty and
late-account cleanup. A claimed allocation is never repeated, including after
restarting the dispatcher. This does not establish a live external-account journey.

Adapted from RawClaw commit
[f37a6e786fdd88857c21bd32140567874e281a8c](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/connections):
domain services/types/repos, generic Composio/catalog adapters, catalog importer,
connection forms and regressions. RawClaw's organization/admission/host policies and
plugin deployment operations are omitted; standalone access and explicit runtime
credentials replace those boundaries. The plugin wire protocol remains compatible.
See [third-party notices](../../THIRD_PARTY_NOTICES.md).

API generation emits one shared schema/type set, the fetch SDK and Fastify handler
types in `generated/` from this component's OpenAPI contract.
