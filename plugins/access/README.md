# Native Account and People

The bundled `clawscarf-access` plugin renders **Account** and **People** inside
OpenClaw, using its public experimental Control UI plugin API in pinned 2026.9.4.
Account shows the signed-in identity and sign-out. People is visible to native
administrators: it lists members and their observed native roles, assigns existing
roles, creates copyable invitations, revokes invitations and removes access.
Role definitions remain OpenClaw configuration; there is no second role database.

The browser calls the Access companion's generated REST client on the same origin.
Every management request verifies the current browser session and native administrator
authority; writes also require CSRF protection. Sidebar visibility grants no permission.
Plugin JavaScript is trusted application code, not a sandbox. It receives neither a
provider secret nor a reusable backend administrator credential. Disabling the plugin
hides these pages without disabling ingress authentication or revocation.

The installation preset includes the plugin by default. Account works in local and
OIDC modes. The token-only component fixture has one operator-managed administrator
and no invitations; new installations use OIDC.
The external companion serves login/callback/setup endpoints, not an Access dashboard.
Connections retains its existing separate interface until its own selected rewrite.

Build with `pnpm access:plugin:build`; validate with `pnpm access:plugin:check`.
The native builder bundles the shared generated REST client and records hashed assets
in [the plugin manifest](openclaw.plugin.json). There is no separately hosted frontend or injected DOM.
The plugin uses native page/navigation registrations and host dialogs, with a small
page renderer. See [Access](../../services/access/README.md) for backend behavior and
[upstream's plugin UI contract](https://docs.openclaw.ai/plugins/feature-plugins).
