# Connections management adapter

Connections is optional. Its [native OpenClaw plugin](../../plugins/connections/README.md)
and matching CLI use the installation's Access session through
[the management adapter](cloud/http.ts). Each request proves current native
administrator authority; writes also require CSRF protection. The adapter checks
session revocation again after native verification and forwards a scoped management
credential and short-lived authority assertion to the cloud. Provider secrets never
enter OpenClaw or the browser.

The [cloud service](https://github.com/clawscarf/clawscarf-cloud) owns accounts,
provider adapters, the catalog, quotas, encrypted results and cleanup. The plugin's
search/describe/call tools use a separate installation-scoped runtime credential.
Account linking, reconnecting, grants, removal and usage are application operations;
the installer only enables the capability and registers the installation.

Account OAuth terminates at the broker. Its opaque receipt returns through the same
browser to this adapter, which rechecks the session and current native administrator
authority before activation. Polling cannot complete another browser's callback.
Expired setups and revoked actors cannot activate accounts; repeated callbacks cannot
change their bound destination. OAuth success alone is insufficient. This requires
no inbound broker connection to the installation.
[cloud/http.ts](cloud/http.ts) and [the local contract](cloud/openapi.json) own these routes.

The [companion](../../apps/companion/README.md) mounts this adapter only when configured.
Disabled installations require no broker key, catalog, schema or service. An enabled
capability with no linked accounts is valid. The cloud deployment and credentials are
documented in its [runbook](https://github.com/clawscarf/clawscarf-cloud/blob/main/RUNBOOK.md).

[OpenAPI](cloud/openapi.json) owns the local management contract; regenerate its
shared browser/CLI client and handler types with `pnpm connections:management:generate`.
The [authority regression](../../tests/connections/cloud-management.test.ts) covers
member denial, CSRF, revoked sessions and credential forwarding. Broker lifecycle,
provider and quota regressions live with the cloud implementation. Historical local
schema migrations are retained as migration history; new installations do not run them.

See the [CLI guide](../../deploy/deployment/installation.md#connections) for operation,
and [third-party notices](../../THIRD_PARTY_NOTICES.md) for provenance.
