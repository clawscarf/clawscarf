# Native Account and People

The bundled `clawscarf-access` plugin renders **Account** and **People** inside
OpenClaw, using its public experimental Control UI plugin API. The
[package manifest](package.json) pins the SDK.
Account shows the signed-in identity and sign-out. People is visible to native
administrators: it lists members and their observed native roles, assigns existing
roles, creates copyable invitations, revokes invitations and removes access.
Role definitions remain OpenClaw configuration; there is no second role database.
The page explains and disables last-administrator removal and demotion using the
observed native roles; the backend independently enforces the same protection.

The browser calls the Access companion's generated REST client on the same origin.
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
