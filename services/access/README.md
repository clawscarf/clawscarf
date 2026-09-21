# Standalone access

Generic OIDC for one ClawScarf server; the installer configures either hosted login
or the user’s own OIDC provider. The service
owns enrollment and revocable browser sessions; OpenClaw owns application roles.
There are no RawClaw organizations, allocations, host records or provider accounts.

Hosted setup explicitly selects the authenticated cloud owner as the initial administrator.
Company OIDC without an explicit administrator uses a private, one-use claim link.
Ordinary login never grants admission or administrator authority. People management
renders in the native plugin; no identity server or
password database is bundled with the installation.

The implementation contains session services, Postgres persistence, generated
[REST handlers/client](openapi.json) and the streaming reverse proxy. The
[native plugin](../../plugins/access/README.md) owns Account/People UI;
[CLI operations](../../deploy/deployment/installation.md#team-administration) share
the same API. Verification instructions are [below](#reuse-and-verification).

## Configuration and operation

Set `CLAWSCARF_ACCESS_CONFIG` to an operator-owned JSON file. It contains `origin`,
`host`, `port`, `databaseUrl`, `encryptionKeyFile`, `runtime.origin` and `identity`.
`encryptionKeyFile` contains exactly 32 random binary bytes and must survive restart.
It is not included in an image. The database is a separate persistent Postgres service.
The access process never runs migrations.

In a container, `containerLoopbackPublication: true` permits `host: "0.0.0.0"` with
loopback-only Compose publication. The operator retains restrictive permissions on
private configuration and OIDC client credentials.

For the assembled single-host path, use the [team profile](../../deploy/deployment/README.md#team-profile).

The [native People plugin](../../plugins/access/README.md) observes native enrollment readiness on its
existing list read; it does not store a second readiness flag or change native
configuration during refresh. REST and CLI list responses include `enrollment`, observed native roles and assignments.

Team identity uses `mode: "oidc"`, `issuer`, `clientId` and `clientSecretFile`.
Network-accessible installations require HTTPS. Loopback-only installations may use
HTTP with an HTTPS OIDC provider; their application and widget listeners must remain
bound to loopback (including Docker publication). The provider callback is
`<origin>/_clawscarf/callback`; its post-logout callback is `<origin>/_clawscarf/signed-out`.
Sign-out revokes the local session and follows the provider logout endpoint when
available. The next successful browser login must request fresh authentication with
OIDC `prompt=login`, including when the provider has no logout endpoint. The browser
marker clears only after successful callback; failed attempts retain it. Rejected or
unverified identities also trigger fresh authentication, so retrying can select another account. This does not
claim to terminate a provider-wide session when its logout endpoint is unavailable.

The initial administrator has a stable UUID reserved before native configuration.
Native initial configuration must use the same `clawscarf:<UUID>` identity.
Administrator setup and teammate enrollment set the native display name to the
person’s email through `users.setDisplayName`, preserving an existing custom name.
Email is presentation only: it never replaces or links the stable authorization identity.

Hosted setup supplies the cloud-verified issuer/subject and email as explicit initial
bootstrap input. After startup, the local operator verifies native administrator
authority and team preparation using a temporary session that it always revokes. This
is initial setup, not a recurring grant from cloud account ownership.

Without an explicit administrator identity, the local operator issues a private setup
link using [the setup command](runtime/setup.ts) with `--issue`. The link expires after
15 minutes. Its holder authenticates through the configured OIDC provider with a verified
email. Until setup completes, ordinary sign-in and expired login callbacks direct the
owner back to the installer for its private link rather than starting an unadmitted login.
The link never grants access without successful authentication and native verification.
Access binds that exact issuer/subject, verifies native administrator authority,
prepares native team access and only then admits the user and creates their browser
session. A temporary server-side credential permits this verification before admission.
Replacing the link invalidates outstanding setup credentials; a failed native check can
be retried only by the bound identity. Completion consumes the link permanently, including
across restarts. The command without `--issue` reports setup status without issuing a link.
Setup links finish on an authenticated page directing the administrator back to the
terminal. The installer offers a replacement link on expiry; cancelling leaves services running.

Unattended configuration can instead supply both `administratorSubject` and
`administratorEmail`. Ordinary company sign-in never enrolls another identity. `runtime.managementOrigin` optionally selects
a reachable ingress endpoint from inside Compose; the public Host/Origin remain
unchanged and ingress records the actual network peer.

- Run `pnpm access:migrate` with separate `CLAWSCARF_MIGRATION_DATABASE_URL` credentials.
  Give the runtime database role table DML and schema usage, not DDL authority.
- Run [identity command](runtime/identity.ts) to initialize/read the
  durable server ID and initial administrator identity before generating native config.
  Identity and setup commands open only Access storage; they require neither
  browser assets, native runtime availability nor OIDC/TLS secret files.
- Run `pnpm access:start` for the backend alone; the [native plugin](../../plugins/access/README.md)
  owns UI build instructions and the [companion](../../apps/companion/README.md) owns combined startup.
- Native preparation assigns the initial administrator explicitly before changing the
  default role to pending. Invitation acceptance assigns the existing member role.
- Run `pnpm access:generate` after changing [the contract](openapi.json).

[The companion application](../../apps/companion/README.md) is the process entry for
Access plus optional Connections. It serves no management dashboard; Account/People and optional Connections assets ship in native plugins.
The [Access-only entrypoint](../../apps/access/entry.ts) is for isolated component
work. Process configuration and lifecycle belong to the
[companion application](../../apps/companion/README.md).

The management client uses OpenClaw’s canonical `gateway-client` / `backend`
identity and advertises the ClawScarf package version. The SDK dependency version
is pinned separately; it is not the caller’s application version.

## Invitations and roles

People is the native administrator page; Account is available to every admitted user.
An administrator creates an invitation for an email address and copies its link. Links
expire after seven days and may be revoked. There is no email delivery service. The
recipient signs in through the configured generic OIDC provider; the verified email
must match. The first valid attempt binds the OIDC subject, so a failed native enrollment
cannot transfer the invitation to another identity. Successful native member enrollment,
admission, invitation consumption and browser session creation are confirmed before entry.
Database admission and invitation consumption commit atomically.

Acceptance rechecks the issuing administrator's current admission revision and native
authority. Removal/rejoining or demotion of the issuer prevents an old invitation from
being used. Short-lived internal credentials exist only during that acceptance; they
are never sent to the browser and are removed afterward. Uncertain native writes leave
the recipient unadmitted; retry requires using the invitation again. They are never
replayed automatically. Ordinary OIDC sign-in alone never admits a person.

Invitations grant the existing native `member` role. Administrators assign other native
roles separately, with an expected-current-role check. Demotion/removal must leave another
currently admitted and natively eligible administrator. Admission removal invalidates
sessions and closes active ingress streams; it does not delete native profiles, team
files or automations. Rejoining resets retained native authority before admitting the
person again. External edits remain visible on refresh; refreshing does not reapply them.

For authenticated automation, use the [team CLI](../../deploy/deployment/installation.md#team-administration).

## Security and state

Login uses PKCE, state, nonce, verified identity claims and one-use transactions.
Only admitted subjects receive sessions. Return destinations are canonical same-origin
paths; reserved application pages require an explicit composition grant. Browser sign-in failures show a concise page
with a fresh sign-in link; they retain the failure HTTP status and never replay the
request or display provider details. API clients retain typed Problem Details. Failed
callbacks clear the login cookie. The shared HTTP server accepts request bodies up to
256 KiB; Fastify rejects larger bodies with 413 Problem Details before dispatch.
Malformed or empty JSON and schema failures return 400; unsupported content types
return 415. Unexpected/native service failures emit a structured error event with
the server-generated request ID, operation, status, classification and an allowlisted
source location when available. No request headers, query values, vendor messages or
raw error stacks are logged.
Individual operations apply their own narrower field and argument limits.
Session authentication checks current
admission revisions; revocation cannot revive after a later admission. Stored logout
hints are encrypted and bound to their session. Browser mutations require exact
Origin and CSRF validation; the OpenAPI contract declares both session-cookie and
CSRF requirements.

The runtime connection uses the [OpenShell transport](../../deploy/openshell/README.md#application-transport).
That guide owns the forwarding implementation; Access owns HTTP/WebSocket authorization.
Ingress reuses upstream HTTP connections and queues bursts behind an eight-socket
pool per protocol (at most two idle sockets). This limits asset-download fan-out
within the controller’s shared connection budget; it does not remove that budget
or reserve capacity for an unlimited number of WebSockets. Its ten-second deadline
covers connecting, not waiting for response headers or a valid stream to finish.
The [ingress regressions](../../tests/access/session.test.ts) exercise queued asset
bursts, delayed response headers, streaming and revocation.

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
The [deployment configuration](../../scripts/deployment/configuration.ts) selects
the companion's Docker-DNS management endpoint and certificate name, preserving
its actual client address rather than sending loopback as forwarded attribution.

An application can additionally supply one typed
[companion API route](types/ingress.ts) with a distinct HTTPS origin and a bounded
`/_clawscarf/` path prefix. This origin is accepted only on the management TLS
listener and dispatches HTTP directly to the companion handler. It has no native
upstream, WebSocket upgrades, login paths or session injection. Authorization and
Cookie headers reach the companion's existing authentication unchanged. The public
listener rejects this origin; the original application Host on management TLS keeps
its existing session authorization and native forwarding. The
[listener boundary test](../../tests/access/companion-api.test.ts) covers Host,
path, upgrade and disabled-route rejection. The composing app owns the concrete
route selection. The current companion does not enable this separate API origin.

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
identity or browser cookie. The native regression below exercises hook admission;
its result is distinct from browser widget acceptance.

Active application connections are revalidated every two seconds. Revoked identities
close; an unresolved authorization check closes only when its freshness expires.
Healthy streams have no arbitrary maximum connection lifetime. Native RPC payloads
are never filtered or rewritten. Sign out in native Account revokes its session
and redirects through provider logout when configured. Native OpenClaw currently has
no configured external-logout hook in the inspected control-UI/trusted-proxy schema;
its token/disconnect actions must not be treated as companion logout. The
[Account and People plugin](../../plugins/access/README.md) renders those pages
inside OpenClaw and calls the external Access API. It is bundled by default;
authentication and revocation remain enforced independently of its UI.

The database retains server identity, admitted users, invitations, login transactions and sessions.
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
The maintained [membership patch](../../runtime/openclaw/patches/membership-hot-reload.prompt.md)
hot-applies native identity grants without restarting the shared Gateway; changed
or removed identities reconnect while unrelated users stay connected. The patch
intent owns its native policy and regression requirements.
After a new identity’s read-only grant is persisted, enrollment briefly observes
its effective native admission while native auth reloads. Every attempt rechecks
the acting administrator and exact grant; persistent denial fails without admitting
the person. Ordinary authorization failures are not retried and mutations are never
replayed. Correlated native validation/authorization rejections before any successful
write retain a definitive failure; transport loss, unknown native codes and native
activation failures retain an uncertain outcome. A later failure after an acknowledged
write also remains uncertain for the overall operation. `UNAVAILABLE` is not proof
of rejection: native configuration may already have persisted before activation failed.
The real SDK/TLS WebSocket regression covers these cases without running OpenClaw.
HTTP 401/403 from the SDK handshake is classified as denied before work starts;
HTTP 503 remains unavailable. This transport classification is confined to connection
setup and never turns uncertain writes into definitive rejections. Each administrator
connection proves native authority once; domain observation additionally verifies the
acting profile without repeating the same administrative RPC.

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
company IdP, deployed callback/TLS configuration, or a published-release installation.
Use the [release evidence](../../release/README.md#release-evidence) for that boundary.

API generation emits one shared schema/type set, the fetch SDK and Fastify handler
types in `generated/` from this component's OpenAPI contract.
All REST clients share the [generated HTTP transport](../../generated/README.md).
