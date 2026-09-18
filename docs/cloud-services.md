# Hosted login and Connections

Hosted login, installation registration, the cloud Connections broker, native People/
Connections pages and installer integration are implemented. The installer defaults to
production; a release or `--cloud-url` can select staging. Hosted login and optional
Connections are independent. The installation has no token-only login, local broker or
standalone Connections dashboard.

Fresh macOS installations passed first-administrator login and GPT-6 Astra / medium
responses using both hosted login and a separately configured OIDC client. Against the
Vercel/Neon staging deployment, native Connections completed Outlook authorization and
a read-only profile call. Retained enable/disable preserved native state and cloud account
records; disabled Connections had no native page. Live checks covered installation
isolation, credential-purpose separation, disconnect and credential revocation, including
continued Account access after broker revocation. Real PostgreSQL regressions cover quota
races, idempotency, cross-account denial, admission, invitations and session revocation.
Earlier two-person WorkOS/native checks remain applicable; they were not repeated against
this staging deployment. Disposable servers, provider accounts and login clients were cleaned up.

Staging and production run the same promoted cloud artifact. Production passed deployment
health, identity and deployment-ID checks; the complete browser journey above ran against
staging. This does not establish Linux/WSL or public-HTTPS installation acceptance. The
upstream remote skill-path and browser-routing issues remain separately in [TODO.md](../TODO.md).
A device-approval session edge case remains in TODO: the provider page can require an
intervening cloud sign-in before accepting its pending code. WorkOS Connect supplies no logout endpoint; sign-out revokes the installation session and
requests fresh authentication on the next sign-in.

[Cloud usage and limits](https://github.com/clawscarf/clawscarf-cloud#registration-and-credentials)
and the [cloud runbook](https://github.com/clawscarf/clawscarf-cloud/blob/main/RUNBOOK.md)
are owned by that repository.

## Product choices

ClawScarf defaults to our hosted login. Company or customer-operated OIDC is always
available instead. No identity server or home-grown account/password system is bundled. People, admission, session revocation
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

The [cloud repository](https://github.com/clawscarf/clawscarf-cloud) is one service,
deployed on Vercel with PostgreSQL/Neon, WorkOS and Composio. Its component READMEs own
its structure and operation. Each domain owns its SQL and provider adapters. Scheduled
maintenance uses the authenticated Vercel cron endpoint; no separate worker is deployed.

This repository retains the installer, Access/ingress, native People and Connections
plugins, and a small authenticated management adapter to the broker. The cloud owns
connection/account records, provider credentials, grants, receipts and usage. It must
not depend on local Access database tables or import this repository's private modules.

The reviewed broker and its useful regressions live in the cloud repository. Required
migration history and notices remain here. Existing development connections are not
silently migrated between services; changing service ownership requires explicit relinking.

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
- The cloud owns [Connections services](https://github.com/clawscarf/clawscarf-cloud/tree/main/src/connections), their SQL,
  provider adapters, catalog importer and targeted tests, scoped by installation credentials.
- Retain the [runtime plugin](../plugins/connections/README.md) and generic tool behavior.
  Both pages use [native plugin UI](../plugins/access/src/control-ui.ts).
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

## Identity and installation registration

A cloud account owns service allowance and one or more registered installations.
An installation UUID identifies a server; it is not a credential. Cloud account
ownership does not automatically confer OpenClaw administrator authority or access
to connector contents. Installation People continues to use native roles.

Use maintained OIDC/OAuth implementations. WorkOS documents
[Connect application management](https://workos.com/docs/reference/workos-connect/applications),
[OIDC discovery](https://workos.com/docs/reference/workos-connect/metadata) and
[CLI device authorization](https://workos.com/docs/authkit/cli-auth). The browser path uses an installation-specific OIDC client with
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

The management page uses OpenClaw's native plugin UI, like People. The page offers add, reconnect, disconnect, remove inactive
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
account. Provider OAuth callbacks terminate at the cloud, which returns the opaque receipt
through the same browser to the installation. The local adapter rechecks that returning browser's
admission and native authority before completing activation. The originating tab cannot
activate another browser's callback by polling. No inbound cloud connection to a laptop
or private server is required.
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

The [cloud API contract](https://github.com/clawscarf/clawscarf-cloud/blob/main/api/openapi.json)
defines structured quota, rate-limit, authorization and provider failures, including uncertain
execution outcomes. Expose only the customer's applicable scope, unit and reset/retry
information, not other tenants' usage or private global budgets. Quota exhaustion must
not look like OAuth disconnection. Administrative inspection and local disconnect remain
available; cleanup can remain pending if the provider itself is unavailable or limited.

Connections limits never revoke People access, expire unrelated login sessions or stop
OpenClaw/models. Later payment integration changes the same server-owned allowance policy;
defer Stripe, purchases, currency accounting, subscriptions and software license machinery.
Choose concrete free limits before public exposure; do not silently ship unlimited defaults.

## Scope boundaries

[TODO.md](../TODO.md) is the only backlog. Billing, private-broker packaging, VM SaaS,
identity migration tooling, public release packaging and additional-platform acceptance
remain separate work. The owner-managed upstream browser issue is not an automatic task.
