# Cloud client

[openapi.json](openapi.json) is the public contract copied from
[clawscarf-cloud](https://github.com/clawscarf/clawscarf-cloud/blob/b3fa7233f5851ef4594277a035c9212d22c2a0b3/api/openapi.json).
It includes registration, Connections, billing and hosted AI. Installation registration
and the Connections management adapter consume this client. The installer also
uses owner-authorized AI enablement, catalog validation and scoped credentials.
Native purchase controls are maintained separately from registration.
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
