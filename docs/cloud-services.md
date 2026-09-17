# Hosted login and Connections

Selected product direction. Cloud owner login/logout and installation registration are
implemented and locally tested against real WorkOS and PostgreSQL. Registration covers
separate scoped credentials, revocation and exact OIDC callbacks. The existing installation
OIDC adapter completed real administrator and invited-member login. The current working
tree passed native member denial, open-session revocation and rejected reentry, plus generic
OIDC handover/rejoining regressions. Logout requests fresh authentication on the next sign-in;
WorkOS Connect currently has no logout endpoint in discovery, so this does not end its
provider-wide session. Full installer registration wiring remains unfinished. Cloud Connections
and deployment are pending. [Cloud usage and limits](https://github.com/clawscarf/clawscarf-cloud#registration-and-credentials)
are owned by that repository; the implementation sequence is owned only by
[TODO.md](../TODO.md#hosted-login-and-native-connections).

## Product choices

ClawScarf defaults to our hosted login. Company or customer-operated OIDC is always
available instead. Do not bundle Keycloak or replace the token-only preview with
another home-grown account/password system. People, admission, session revocation
and native OpenClaw roles remain installation-owned.

Connections is independent of login: disabled, our hosted service, or eventually a
privately operated compatible service. Hosted login does not require Connections.
Customer OIDC plus our Connections does not require cloud accounts for teammates.
The owner links a cloud account for service ownership; that does not replace the
team's identities. Login availability never depends on connector credits or quotas.
Keep the current recipe's Connections default disabled unless explicitly selected;
enabling it can default to our service without requiring Composio setup by the user.

| Deployment               | Login                                 | Connections ownership                           |
| ------------------------ | ------------------------------------- | ----------------------------------------------- |
| Easy self-hosting        | Our hosted identity provider          | Same cloud account, if enabled                  |
| Company installation     | Customer OIDC                         | Owner links our cloud, or disables Connections  |
| Independent installation | Customer OIDC                         | Disabled or future privately operated broker    |
| Future hosted SaaS       | Hosting product's configured identity | Provisioned under its existing customer account |

The easy default depends on internet access and our identity service for new logins.
Custom OIDC must work without registering with our cloud when Connections is disabled
or privately operated. Changing identity provider is an explicit reconfiguration;
matching email addresses must never silently transfer admission or administrator rights.

## Repository and service ownership

Create the cloud repository at `~/clawscarf/clawscarf-cloud`. Keep it a small service,
not another VM control plane or a framework of separately deployed microservices.

```text
clawscarf-cloud/
  README.md, AGENTS.md, LICENSE
  api/                  OpenAPI contract and generated client
  src/
    http/               routes and managed-host entrypoint
    accounts/           cloud account ownership and installation registration
    identity/           hosted identity-provider integration
    connections/        broker, provider adapters, catalog and execution receipts
    usage/              quota policy and atomic accounting
    web/                owner approval, OAuth completion and service usage only
  migrations/           explicit database migrations
  tests/                real authorization, quota and provider-boundary regressions
  deploy/               deployment configuration and scheduled maintenance
```

Each domain keeps its own SQL and provider adapters. No empty package hierarchy.
The intended managed deployment is Vercel plus PostgreSQL/Neon and WorkOS for human
cloud authentication, with Composio initially providing connector operations. Reuse Kora's
existing cloud hosting and account-authentication patterns. During broker integration,
adapt request deadlines, response handling and maintenance scheduling for this service;
do not carry over the companion's process timer as serverless maintenance. This is normal
deployment integration, not a new hosting feasibility project. No new queue or worker
without a demonstrated requirement.

This repository retains the installer, Access/ingress, native People and Connections
plugins, and a small authenticated management adapter to the broker. The cloud owns
connection/account records, provider credentials, grants, receipts and usage. It must
not depend on local Access database tables or import this repository's private modules.

Move the reviewed broker implementation and its useful regressions into the cloud
repository as ownership changes; do not maintain two implementations. Delete the
standalone Connections dashboard and superseded local broker composition after their
native UI and remote-service replacements work. Preserve required migration history
and notices. Existing developer connection data may need explicit relinking; do not
invent compatibility paths or silently discard data.

The cloud owns its OpenAPI contract. Publish a versioned generated client/artifact for
ClawScarf; use an explicit locally built artifact during development. No runtime sibling
checkout imports. Privately operating the broker must remain possible without WorkOS,
Vercel or our cloud account being mandatory dependencies of its execution services.
Packaging that private deployment is later work, not part of the first hosted launch.

## Reuse and new work

This checkout is the primary implementation source, including fixes already made here:

- Retain [Access OIDC](../services/access/providers/oidc.ts), native authority checks,
  administrator claim, admission/session storage and revocation regressions. Adapt the
  issuer/client configuration; do not replace the ingress or People implementation.
- Move [Connections services](../services/connections/composition.ts), their owning SQL,
  provider adapters, catalog importer and targeted tests. Replace single-server/local-session
  composition with authenticated installation scope. Moving files is not simplification by itself.
- Retain the [runtime plugin](../plugins/connections/README.md) and generic tool behavior.
  Follow [People's native page integration](../plugins/access/src/control-ui.ts) for the
  new Connections page; reuse suitable existing account forms and catalog assets.
- Extend existing CLI configuration, setup and lifecycle operations. Do not introduce a
  second installer, supervisor or recipe engine for hosted services.

Other repositories are selective references: Kora Cloud for owner authentication and
deployment enrollment, RawClaw for multi-installation credential/query scoping, and Hearth
for generic Composio consent/callback behavior. Inspect actual source and tests before
copying a needed part. Do not transplant Kora's licensing/subscription checks or RawClaw's
VM lifecycle. Record copied source revision and licensing in notices; no donor imports or
runtime dependency. Existing upstream libraries own OAuth/OIDC and native UI protocols.

Concrete donor references (read-only local checkouts; not runtime dependencies):

```text
~/raw-labs/kora/kora-platform/cloud/apps/accounts/
  src/auth/cloud-auth-provider.ts
  src/services/activation-service.ts
  src/services/managed-deployment-auth-service.ts
  src/services/composio-client.ts
  app/api/managed/integrations/connect/route.ts
  app/api/managed/integrations/connect-callback/route.ts
  vercel.json
~/raw-labs/rawclaw/src/domains/connections/
  repo/credential-store.ts
  service/broker-service.ts
~/raw-labs/hearth/src/providers/composio/
  setup.ts
  http-client.ts
```

Kora's deployment authentication includes license checks: reuse only the needed account,
credential and scope handling, not that policy. ClawScarf's reviewed broker remains the
primary source even where donors have similar code. Bring relevant regression cases with
copied behavior rather than combining multiple parallel implementations.

New code is limited to cloud registration/ownership, cloud composition and installation
authorization, quota accounting, the local management adapter and native Connections UI.
Provider integrations already present should not be rewritten for the repository move.

## Execution checkpoints

[TODO.md](../TODO.md#hosted-login-and-native-connections) owns stable milestone IDs M1–M8
and their completion criteria, including work in both repositories. Do not duplicate
these milestones in a new cloud checklist. The cloud README links back to that owner;
any cloud TODO contains only separately selected future work, not a second progress copy.

At each milestone, inspect changed code, test its real affected boundary, update the
owning docs and remove its TODO only after its completion criteria pass. A blocker stays
as a short unchecked item with the failing boundary and next action. Report implemented,
tested and deployed status separately. Keep evidence in ignored logs/CI and coherent
commits when authorized; do not rely on chat memory or leave critical claims only in logs.

M1 establishes the cloud service and its owner login from existing patterns. M2–M3 add
the part absent from ordinary cloud-site login: automatically register each independently
installed server's OIDC client/callback, then authenticate through that server's Access
service and admission rules. The current Access adapter requires a confidential client
secret and supports client-secret POST/basic. Public-client/device flows are not drop-in
replacements. Test exact callbacks, logout and the supported localhost/private/public
addresses while implementing this flow. Do not work around a provider limitation with a
custom token issuer, unsafe redirect policy or weaker login.

Login becomes usable before broker migration; broker execution works through API/CLI before
native UI; quota enforcement passes before shared cloud access. Final verification joins
already working pieces rather than discovering their first integration. A restricted test
deployment may precede quota enforcement; an openly usable service may not.

There is no separate general feasibility/audit phase. Verify each new integration as it is
built; report a concrete provider or deployment limitation if encountered. Concrete free
quota values are a launch decision, not an excuse to build billing. If an assumption fails,
report the finding and narrow alternatives before expanding scope. Reusing known cloud
patterns does not establish that the newly wired installation journey has passed.

## Identity and installation registration

A cloud account owns service allowance and one or more registered installations.
An installation UUID identifies a server; it is not a credential. Cloud account
ownership does not automatically confer OpenClaw administrator authority or access
to connector contents. Installation People continues to use native roles.

Use maintained OIDC/OAuth implementations. WorkOS documents
[Connect application management](https://workos.com/docs/reference/workos-connect/applications),
[OIDC discovery](https://workos.com/docs/reference/workos-connect/metadata) and
[CLI device authorization](https://workos.com/docs/authkit/cli-auth). Validate those
against our actual localhost, private-LAN and public-host flows before committing the
wire contract. The intended browser path is an installation-specific OIDC client with
exact callbacks, PKCE, state and nonce, using existing Access OIDC handling. Do not build
an OAuth issuer, accept wildcard callbacks or distribute our WorkOS management secret.
Device authorization approves cloud ownership through the dedicated public CLI client;
the cloud verifies its signed access token's issuer, audience, expiry and client ID.
It does not replace normal browser login. Loopback-only installations support HTTP OIDC
callbacks with application/widget ports published only on loopback; LAN/public installations
require HTTPS. Access sign-out revokes its local session and requests `prompt=login` on
the next login. Provider-wide logout additionally depends on a discovered logout endpoint;
WorkOS Connect currently supplies none. Social sign-in is a central provider choice.
Account recovery belongs
to the hosted identity provider, not a new ClawScarf password UI or per-installation SMTP
configuration. Verify recovery, logout and account switching as well as initial sign-in.

The installer registers/authorizes an installation when a selected hosted service needs
it. A private, expiring, one-use administrator claim binds the successfully authenticated
OIDC identity locally and verifies its native authority. The browser confirms completion
and returns the user to the waiting installer. Subsequent login uses the installation
URL and ordinary OIDC, without installer codes. With custom OIDC, administrator claim
uses that provider; optional cloud-service linking is a separate owner authorization.

Invitation links remain in native People, not the installer. A cloud-authenticated
stranger is not admitted automatically. Issuer/subject identity, admission revisions,
last-administrator protection and revocation of open sessions remain enforced locally.

Registration issues separate credentials for installation administration and connector
execution. Management credentials stay outside OpenClaw. Execution credentials cannot
manage accounts, grants, registrations or quota policy. Store secrets privately and
hash opaque credentials in the cloud; support rotation and revocation. Derive account
and installation scope from the authenticated credential, not caller-supplied IDs.

For future SaaS, provide authenticated server-to-server registration under an existing
customer account, using an idempotent external installation reference. Authenticate and
limit the hosting principal's customer scope. Reuse the same registration and broker
services; no interactive second signup and no hosting-provider-specific broker branch.
Implement and test this contract now; do not implement a VM hosting platform here.

## Native Connections and authorization

Keep the small search/describe/call tools and the full existing curated catalog, icons
and descriptions. Provider schemas remain advisory; no connector-specific workarounds.
Provider bindings explicitly identify their backend so a later adapter can coexist with
Composio. Replacing a backend may require reconnecting accounts and rediscovering tools.

Build the management page through OpenClaw's supported native plugin UI, following the
existing People integration. The page offers add, reconnect, disconnect, remove inactive
entries, account selection, agent grants and usage. It uses concise content-level loading,
retains data on refresh, and distinguishes missing data from no accounts. Empty is valid.
No installation/VM work runs when adding an account. Disabled means no page or tools.
Non-administrators receive no management actions; backend authorization remains decisive.

The local adapter authenticates the user and verifies current native `operator.admin`
authority before management calls. It forwards an authenticated installation request with
actor correlation; it does not expose its management credential to the browser. Native
roles remain the human authority source; the broker owns per-agent connection grants.
The cloud trusts the registered installation to enforce its own team policy, not an
unsigned browser claim. A self-hosting root administrator controls that installation;
this does not give access to another cloud customer's records or allowance.

Account linking creates an expiring setup bound to the installation, actor and exact
account. Provider OAuth callbacks terminate at the cloud. The native page observes the
result through its local adapter, rechecking actor admission and native authority before
activation. No inbound cloud connection to a laptop or private server is required.
Late/duplicate callbacks, lost sessions and revoked initiators must not activate accounts.
OAuth success alone is insufficient. Reuse the existing explicit uncertain outcomes.

Management and runtime APIs must scope every lookup, receipt and write to the credential's
installation, including guessed IDs, idempotency keys and result references. Provider
credentials and OAuth state stay cloud-side. Cloud owner/billing UI does not become a
second team or connector-management dashboard. Provider consent screens remain external;
ordinary users never need a Composio developer account.

The CLI uses the same management API and supports structured output. Account consent may
still require a human browser; automation can initiate, inspect and complete supported
flows without pretending third-party consent can always be unattended.

## Quotas before billing

Provide finite operator-configured quotas from the first cloud deployment. A backend means
an adapter/provider such as Composio; a connector means Outlook, Odoo, etc. Keep those IDs
distinct. Support lifetime or explicit time-window counters without a billing dependency:

- Account-wide execution allowance shared across its installations.
- Per-installation execution limits, so one server need not consume the entire allowance.
- Per-backend execution allowances within those scopes.
- Service-wide total and per-backend upstream-request budgets protecting our provider
  accounts, including setup/inspection traffic, plus ordinary API rate limits.

Customer execution allowance counts dispatched tool executions, not native-page refreshes,
catalog searches, description reads or receipt polling. Actual provider HTTP requests are
also metered for operator budgets; one tool call can cause more than one upstream request.
Use explicit quota units. Do not present execution counts as provider invoices or AI credits.
A catalog refresh must not burn customer execution allowance. Cap account/installation
registration and rate-limit setup to prevent new UUIDs from minting unlimited free quota.

Reserve the applicable allowance atomically with the execution dispatch claim, using
PostgreSQL transactions and deterministic locking. Preserve receipts/idempotency across
retries: repeated delivery observes the same invocation without re-execution or a second
charge. Release reservations only when execution is known not to have been dispatched.
Dispatched failures count; unknown outcomes remain reserved/consumed pending evidence,
never automatically refunded or replayed. Reserve upstream-request budget before each
provider request; hidden SDK retries must not bypass it. Recover abandoned pre-dispatch
reservations conservatively; process crashes cannot create free or double executions.

Return structured `quota_exhausted`, `rate_limited`, `service_disabled`,
`credential_revoked` and `provider_unavailable` outcomes, preserving existing uncertain
execution outcomes. Expose only the customer's applicable scope, unit and reset/retry
information, not other tenants' usage or private global budgets. Quota exhaustion must
not look like OAuth disconnection. Administrative inspection and local disconnect remain
available; cleanup can remain pending if the provider itself is unavailable or limited.

Connections limits never revoke People access, expire unrelated login sessions or stop
OpenClaw/models. Later payment integration changes the same server-owned allowance policy;
defer Stripe, purchases, currency accounting, subscriptions and software license machinery.
Choose concrete free limits before public exposure; do not silently ship unlimited defaults.

## Review and verification boundaries

Implement the TODO stages in order, with a working boundary at each handoff. The first
integration must prove fresh install, real hosted login, first administrator, invitation,
normal subsequent login/logout, native connection setup and one real authorized tool call.
Also prove custom OIDC with our broker, Connections disabled, multiple installations under
one account, cross-account denial, quota races/retries and preserved access at exhaustion.

Reuse existing source and tests rather than a broad rewrite. Native UI is a replacement;
the reviewed broker is adapted. Test retained state/revoked credentials when persistence
changes. Test real callbacks and native role enforcement where mocks are insufficient.
Delete disposable infrastructure after testing. Report supported and untested platforms
separately. Billing, a private-broker installer, VM SaaS, identity migration tooling and the
owner-managed upstream browser issue are outside this implementation.
