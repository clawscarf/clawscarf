# Standalone access

Generic OIDC and a protected local sign-in flow for one ClawScarf server. The service
owns enrollment and revocable browser sessions; OpenClaw owns application roles.
There are no RawClaw organizations, allocations, host records or provider accounts.

The implementation contains a session service, Postgres persistence, generated
OpenAPI handlers/client, a native streaming reverse proxy and separate CLI entry
points. Native enrollment has REST, CLI and a People page. Administrator proof and team
preparation, member enrollment, member administrator denial and administrator
self-revocation pass against native OpenClaw 2026.9.4. The assembled [team profile](../../deploy/local/README.md#team-profile-under-qualification)
also has Dex/browser enrollment and handover acceptance; full team qualification remains open.

## Configuration and operation

Set `CLAWSCARF_ACCESS_CONFIG` to an operator-owned JSON file. It contains `origin`,
`host`, `port`, `databaseUrl`, `encryptionKeyFile`, `runtime.origin` and `identity`.
`encryptionKeyFile` contains exactly 32 random binary bytes and must survive restart.
It is not included in an image. The database is a separate persistent Postgres service.
The access process never runs migrations.

Local identity is `{ "mode": "local", "name": "Administrator" }`. Local mode
requires a loopback public origin and normally a loopback bind. In a container,
`containerLoopbackPublication: true` permits `host: "0.0.0.0"`; the Compose host
port must remain loopback-only. Set the container UID/GID to the owner of the private
configuration mount, preserving restrictive file permissions. The operator runs
[local-token command](runtime/local-token.ts) to create a five-minute,
one-use sign-in code and receives the local sign-in URL. The code is exchanged for
an HTTP-only session cookie, never a permanent anonymous administrator session.
Issuing a new code invalidates any outstanding code.
The command's `--json` option returns `{ "url": "…", "code": "…" }` for private
operator tooling. Treat that output as a temporary credential; never log it as diagnostics.

For the assembled single-host path, use the [team profile](../../deploy/local/README.md#team-profile-under-qualification).

The [People interface](web/README.md) observes native enrollment readiness on its
existing list read; it does not store a second readiness flag or change native
configuration during refresh. REST and CLI list responses include `enrollment`.

Team identity uses `mode: "oidc"`, `issuer`, `clientId`, `clientSecretFile`,
`administratorSubject` and `administratorEmail`. Team mode requires an HTTPS origin.
The provider callback is `<origin>/_clawscarf/callback`; its post-logout callback is
`<origin>/_clawscarf/signed-out`. Explicit issuer/subject enrollment is required;
a successful company login does not itself admit a user. The initial administrator
is initialized once with a stable UUID. Native initial configuration must use the
same `clawscarf:<UUID>` identity. `runtime.managementOrigin` optionally selects
a reachable ingress endpoint from inside Compose; the public Host/Origin remain
unchanged and ingress records the actual network peer.

- Run `pnpm access:migrate` with separate `CLAWSCARF_MIGRATION_DATABASE_URL` credentials.
  Give the runtime database role table DML and schema usage, not DDL authority.
- Run [identity command](runtime/identity.ts) to initialize/read the
  durable server ID and initial administrator identity before generating native config.
- Build the browser assets with `pnpm access:web:build`, then run `pnpm access:start`.
- Open `/_clawscarf/team/` for the People page. It requires current native administrator
  authority. The [CLI](runtime/cli.ts) uses the same generated REST client; run it
  with `node --import tsx`, `--origin` and a private `--session-file`. Its commands
  are `people`, `prepare`, `enroll` and `remove`. Local mode cannot enroll company users.
- A member is enrolled by the configured provider’s subject ID, email and name.
  Native team preparation assigns the initial administrator explicitly before changing
  the default role to pending. Enrollment remains closed until native member assignment
  succeeds. Application roles are edited in OpenClaw, not duplicated in this database.
- Run `pnpm access:generate` after changing [the contract](openapi.json).

[The companion application](../../apps/companion/README.md) is the process entry for
Access plus optional Connections. Its image includes both browser surfaces.
The Access-only command above remains useful for isolated component work.
[The Compose fragment](../../deploy/compose/companion.yaml) publishes access on loopback
and requires an explicit image/configuration mount. It does not install or own the
OpenShell runtime or Postgres. The container-loopback topology has passed HTTP and native Gateway management
checks; this fragment is not a finished local installer.

## Security and state

Login uses PKCE, state, nonce, verified identity claims and one-use transactions.
Only admitted subjects receive sessions. Browser sign-in failures show a concise page
with a fresh sign-in link; they retain the failure HTTP status and never replay the
request or display provider details. API clients retain typed Problem Details. Failed
callbacks clear the login cookie.
Session authentication checks current
admission revisions; revocation cannot revive after a later admission. Stored logout
hints are encrypted and bound to their session. Browser mutations require exact
Origin and CSRF validation. Local enrollment is disabled in OIDC mode.

The runtime connection uses [standard OpenShell SSH forwarding](../../deploy/openshell/README.md#application-transport), which preserves native HTTP headers and multiplexes concurrent requests.

Ingress replaces identity and forwarded headers using authenticated session data
and the actual socket address. It does not invent a remote address to bypass native
trusted-proxy checks. The optional `applicationTls` certificate/key pair enables direct HTTPS on the public
listener, independently of private management TLS. Both listeners share authorization,
HTTP forwarding and WebSocket revocation. The public Gateway SDK requires TLS for management credentials. A configured
management endpoint must therefore use HTTPS with a trusted certificate. Configure
`managementTls` with `certificateFile`, `keyFile`, `host` and `port`;
`runtime.managementOrigin` points to that HTTPS listener. It shares the same ingress
handler and revocation tracking as the browser listener. Compose publishes this port
on host loopback and trusts the private CA through `NODE_EXTRA_CA_CERTS` at
`/run/clawscarf/management-ca.pem`. Certificate verification remains enabled.

Local sign-in, native document forwarding, administrator proof and explicit native
team preparation have passed through this Compose/OpenShell arrangement. The initial
profile displays the configured administrator name. A real native regression also
verifies 40 concurrent authenticated page requests, member enrollment, explicit
administrator promotion, self-revocation and
closure of an already-open Gateway connection while preserving another administrator.
See the [assembled team acceptance](../../deploy/local/README.md#team-profile-under-qualification)
for browser login, enrollment and two-tab revocation through a separate Dex provider.
The configured runtime must not be reachable by untrusted
callers bypassing ingress. Application and widget origins must be distinct; widget
requests retain native capability authorization rather than receiving user identity.
`runtime.webhookPaths` explicitly publishes exact native hook URLs for POST only.
The [native hook projection](providers/hooks.ts), adapted from RawClaw’s reviewed
helper, enumerates authenticated built-in and configured mapping paths without
emitting credentials. The operator must keep those bindings aligned with native
configuration; there is no automatic anonymous configuration read. Other paths and
methods remain behind browser login. Published requests keep their native token
and signature headers, but never browser cookies or asserted user identity; native
OpenClaw validates the hook credential. Widget requests also receive no companion
identity or browser cookie. Hook and widget proxy policy tests pass. The native hook journey also passes:
missing credentials receive 401, a valid native token reaches `/hooks/wake`, and
unpublished paths or wrong methods retain login protection. The native dashboard widget also passed an actual browser interaction through the
separate sandbox origin: its button updated from Count 0 to Count 1 inside the
native nested iframe.

Active application connections are revalidated every two seconds. Revoked identities
close; an unresolved authorization check closes only when its freshness expires.
Healthy streams have no arbitrary maximum connection lifetime. Native RPC payloads
are never filtered or rewritten. Sign out in the companion header revokes its session
and redirects through provider logout when configured. Native OpenClaw currently has
no configured external-logout hook in the inspected control-UI/trusted-proxy schema;
its token/disconnect actions must not be treated as companion logout. The
[account navigation plugin](../../plugins/access/README.md) uses OpenClaw’s supported
native UI extension to open the companion account page; it remains separately
optional for other distributions.

The database retains server identity, admitted users, login transactions and sessions.
Keep database and encryption key together. Stop/restart must preserve them. There is
no backup/restore promise or recovery automation in this component.

## Reuse and verification

Copied/adapted from RawClaw
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c):

- [src/domains/access/providers/oidc/provider.ts](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/access/providers/oidc/provider.ts): generic `openid-client` integration.
- [src/domains/access/service/access-service.ts](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/access/service/access-service.ts): PKCE/login/session mechanics.
- [src/domains/access/repo/access-repository.ts](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/access/repo/access-repository.ts) and [session-logout.ts](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/access/repo/session-logout.ts): encrypted
  transactions/logout hints and durable identity/session mechanics.
- [src/domains/access/runtime/](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/access/runtime/): authentication and cookie/CSRF handling.
- [src/domains/installations/providers/ingress/](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/installations/providers/ingress/): HTTP/WS proxy, header sanitization
  and session freshness/revocation behavior.
- Relevant RawClaw session/logout/ingress test cases adapted in [access regression tests](../../tests/access/session.test.ts).

Fleet route publication, central-portal ticket delegation, organization policy,
WorkOS-specific provider and host-side native launchers are intentionally omitted.
Native authority adapters must verify current Gateway authority; the persisted
bootstrap administrator reference is not a reusable administrator permission grant.
After a new identity’s read-only grant is persisted, enrollment briefly observes
its effective native admission while native auth reloads. Every attempt rechecks
the acting administrator and exact grant; persistent denial fails without admitting
the person. Ordinary authorization failures are not retried and mutations are never
replayed.

`pnpm test:access` runs isolated tests. Supplying `CLAWSCARF_TEST_DATABASE_URL` enables
the real Postgres/REST cases; use a disposable database, as those tests create and
remove their schema. Without it, the database cases are explicitly skipped.
The signed local IdP also exercises the registered login/callback and enrollment
handlers: browser-cookie binding, callback replay, two identities, CSRF, uncertain
native enrollment remaining closed, removal/rejoin without old-session revival,
and the provider logout return. Native authority is controlled in these Postgres
cases; OpenClaw/browser/production qualification is separate.

[The opt-in native regression](../../tests/access/native-live.test.ts) uses
`CLAWSCARF_NATIVE_TEST_CONFIG` and `CLAWSCARF_NATIVE_TEST_SESSION_FILE` for a
disposable, already-prepared native server and a private current administrator
session file. Run it with `pnpm exec tsx --test tests/access/native-live.test.ts`,
with the management CA trusted through `NODE_EXTRA_CA_CERTS`. It creates and
removes only fixture users through native APIs, retaining the original administrator.
A signed local IdP and the registered HTTP handlers exercise two fixture identities
against the real Gateway: member denial, native administrator promotion and handover,
rejoin resetting prior administrator authority, and logout closing only the affected
native stream. The test IdP is composed into test handlers without changing the
running companion's identity configuration. These checks do not qualify an external
company IdP, its deployed callback/TLS configuration, or interactive browser enrollment.
