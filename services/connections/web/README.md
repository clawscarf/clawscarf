# Connections UI

The standalone account manager lives at `/_clawscarf/connections/`; native
OpenClaw pages remain unchanged. HTTP registration can serve this Vite build with
the Access session and CSRF boundary through the
[companion application](../../../apps/companion/README.md). The browser uses the
[generated Connections client](../generated/client/sdk.gen.ts) and the
[generated access client](../../access/generated/client/sdk.gen.ts).

Administrators can browse the configured catalog, create named accounts, complete
or resume provider setup, reconnect, change agent grants and disconnect. Agent
inventory is requested only when selecting individual agents. Refresh reads current
records; each mutation carries a revision and stable idempotency key. Expired,
cancelled and uncertain setup states remain distinct. Redirects happen only for a
setup explicitly started or resumed in the browser. Provider callbacks are staged
server-side before a clean return page completes them with the current session.
Disconnected records are hidden by default and available with **Show disconnected**.

Without provider configuration, the page shows that Connections are disabled and
exposes no account actions. This is availability information, not native authority:
the service independently verifies current OpenClaw administrator access.

`pnpm connections:web:build` creates the production assets.
`pnpm connections:web:dev` runs Vite against a local companion on port 3000.
The shared header provides OpenClaw and Sign out, using the generated Access
logout endpoint with its current CSRF token. The same theme scope and responsive
header geometry are used by People. The built output is ignored. Operational setup belongs in the [service README](../README.md).

## Reuse

Account forms, catalog selection, setup states, tables, mutation receipts, callback
presentation and shared primitives are adapted from
[RawClaw's Connections UI at f37a6e7](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/apps/web/domains/connections).
The visual primitives and semantic theme are extracted from its Kora-derived
[shared UI](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/apps/web/shared)
and [theme](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/src/apps/web/styles/theme.css).
The original [shadcn notice](shared/shadcn/LICENSE.md) is retained. Organization,
installation navigation, hosting operations and plugin deployment controls are not
part of this single-server UI.

The browser passed the full 44-entry catalog, icons, categories, search, account
form and a simulated provider redirect/return to Connected. The 390px layout and
Odoo search/form also passed. These checks use a local provider fixture; no real
external account was connected. Actual provider acceptance remains separate.
