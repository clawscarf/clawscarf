# Native Account and People

The bundled `clawscarf-access` plugin renders **Account** and **People** inside
OpenClaw, using its public experimental Control UI plugin API. The
[package manifest](package.json) pins the SDK.
Account shows the signed-in identity and sign-out. When Cloud AI or Connections
is configured, installation administrators also see account-wide balances, current
packs and model rates. Payments use an explicit Cloud owner sign-in and Stripe's
hosted Checkout/Portal. Native administrator rights alone cannot purchase; the
companion holds the temporary owner token, never browser JavaScript. Prices and
balances come from Cloud; no fixed introductory allocation is promised.
Saved checkout requests resume with the same idempotency key. A payment awaiting
credit activation remains pending, with new purchases disabled for the affected
service and a warning against paying again. Expired or declined billing sign-in
offers a fresh sign-in; pending approval can be cancelled. An unreadable saved
checkout can be cleared after viewing recent purchases and confirming that this
does not cancel or refund a payment. A return
from Stripe is not proof that credit was granted. Recent purchases and refunds
remain visible through purchase history and Stripe payment details. Refreshes
retain expanded prices and purchase history and preserve keyboard focus.
A native session-header accessory supplies Account recovery guidance after failed
Cloud AI chats; OpenClaw keeps its own error presentation. Members are directed to
an installation administrator. It neither buys credits nor redirects automatically.

People is visible to native
administrators: it lists members and their observed native roles, assigns existing
roles, creates copyable invitations, revokes invitations and removes access.
Role definitions remain OpenClaw configuration; there is no second role database.

The browser calls the Access and Cloud-management generated REST clients on the same origin.
Every management request verifies the current browser session and native administrator
authority; writes also require CSRF protection. Sidebar visibility grants no permission.
Plugin JavaScript is trusted application code, not a sandbox. It receives neither a
provider secret nor a reusable backend administrator credential. Disabling the plugin
hides these pages without disabling ingress authentication or revocation.

The installation preset includes the plugin by default. Account and People use the
same native authority with either hosted login or customer OIDC.
The external companion serves login/callback/setup endpoints, not an Access dashboard.
Optional Connections also renders through its native plugin.

Build with `pnpm access:plugin:build`; validate with `pnpm access:plugin:check`.
The native builder bundles the shared generated REST client and records hashed assets
in [the plugin manifest](openclaw.plugin.json). There is no separately hosted frontend or injected DOM.
The plugin uses native page/navigation registrations and host dialogs. Its
[page renderer](../common/native-page.ts) is shared with Connections and bundled
into both native UI artifacts; it has no React runtime or separate frontend build.
See [Access](../../services/access/README.md) for backend behavior and
[upstream's plugin UI contract](https://docs.openclaw.ai/plugins/feature-plugins).
