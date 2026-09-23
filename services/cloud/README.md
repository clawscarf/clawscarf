# Cloud client

[openapi.json](openapi.json) is the public contract copied from
[clawscarf-cloud](https://github.com/clawscarf/clawscarf-cloud/blob/aa03c76b09571cde0d3613142aeb2ca088e62cde/api/openapi.json).
It includes registration, Connections, billing and hosted AI. Installation registration
and the Connections management adapter consume this client. The installer also
uses owner-authorized AI enablement, catalog validation and scoped credentials.
Installer purchases use the same owner-authorized checkout, order and allowance APIs
as native Account. An installer return uses `path: null`; the native plugin supplies
its installation-relative path. Both bind checkout to the return request ID.
The installer retains purchase intent privately across interruptions.
The Connections plugin derives only the runtime routes for its portable SDK.

Run `pnpm cloud:generate` after updating the source contract; generated clients use
our shared HTTP transport. `pnpm codegen:check` detects local generation drift.
The [native management contract](management/openapi.json) exposes balances,
offers, model prices, owner device authorization and hosted payment navigation
through the companion. Run `pnpm cloud:management:generate` after editing it.
The [adapter](management/http.ts) fixes the upstream service and installation from
private configuration and checks fresh native administrator authority. Only the
nonfinancial capability flags are readable by admitted members. Financial calls
require a separate Cloud owner token bound to the admitted browser session;
[owner authorization](management/owner.ts) verifies the registered Cloud account
and retains that token only in memory for at most 30 minutes. CSRF applies to all
writes. Provider tokens, Stripe keys and account accounting remain Cloud-owned.
See [Account](../../plugins/access/README.md) for presentation and recovery.
No Cloud server implementation or secret belongs here.
