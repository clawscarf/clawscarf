# Component operator internals

Use the [installation CLI](installation.md) for a team installation. This document describes lower-level developer commands and the generated local configuration consumed by that CLI. Component-only examples deliberately omit parts of the product and are not alternative installation recipes.

This operator path assembles the existing components for local evaluation on macOS
arm64 with Docker Desktop. `prepareLocal` initializes private configuration, the database
and native volume. `launchLocal` starts Docker services and protected runtimes, checks readiness, then returns. Fresh startup, native administrator
browser login, a configured model/tool interaction and retained-state restart have
passed. The [terminal installer](installation.md#terminal-installer) collects a unified
installation document and calls these same operators for initial setup.

Build the [runtime](../images/README.md) and [companion](../../apps/companion/README.md)
images and obtain the pinned [controller executables](../openshell/README.md#contributor-controller-setup).
Use the supported [contributor toolchain](../../scripts/README.md). Supply an input
JSON file with this shape, replacing the image placeholders with exact local Docker
image IDs or registry digest references, and executable paths with absolute paths:

```json
{
  "name": "my-team",
  "administratorName": "Administrator",
  "team": {
    "origin": "http://127.0.0.1:18800",
    "widgetOrigin": "http://127.0.0.1:18802",
    "issuer": "https://identity.example.com",
    "clientId": "your-client-id",
    "clientSecretFile": "/absolute/private/oidc-client-secret"
  },
  "runtimeImage": "sha256:REPLACE_WITH_RUNTIME_IMAGE_ID",
  "companionImage": "sha256:REPLACE_WITH_COMPANION_IMAGE_ID",
  "openshellCli": "/absolute/path/to/openshell",
  "openshellGateway": "/absolute/path/to/openshell-gateway",
  "openshellClientImage": "sha256:REPLACE_WITH_OPENSHELL_CLIENT_IMAGE_ID",
  "ports": {
    "controller": 17671,
    "application": 18800,
    "widgets": 18802,
    "management": 18801,
    "native": 18789,
    "nativeWidgets": 18790,
    "database": 15432
  },
  "cpu": "2",
  "memory": "2Gi"
}
```

All ports must be distinct. Preparation and startup check that the configured
controller executables are runnable files and probe every host loopback port before
changing Docker resources. An occupied database port is accepted only when Docker
reports one running PostgreSQL container with this installation's exact ownership,
Compose project/service labels and loopback publication. Other occupied ports stop
setup with the affected listener named. These checks do not reserve ports; another
process can still claim one before startup. A failed preflight retains any initialized
private installation directory for resumption.
Both loopback and public installations require an OIDC team profile. The installer
registers hosted identity automatically or accepts customer OIDC. The
[team profile](#team-profile) also supports public TLS using the same operator.
No AI or connection provider key is required by preparation.

The CLI generates this internal input and calls [prepareLocal](../../scripts/deployment/prepare.ts).
For a supported installation, use [configure, plan and apply](installation.md).

Preparation reserves actual Docker bridge networks using Docker's allocator:
one for companions and one for OpenShell. Each has installation/purpose labels and a
recorded exact ID. Compose consumes the companion network as external; OpenShell uses
its reserved runtime network. Startup verifies their IDs and ownership before starting
processes. This establishes allocated capacity, not a speculative count from Docker's
possibly absent address-pool metadata. It does not prove later service connectivity.

Network creation intent is recorded before allocation. If a response is lost, preparation
reconciles the matching owned network and records its ID. An absent network after a
recorded attempt remains uncertain and requires operator inspection; it is never
blindly allocated again. A partial setup retains its first network if reserving the
second fails. Foreign, unlabeled, replaced or ambiguous networks are rejected, not
adopted or deleted. An optional browser adds separate isolated browser and machine
bridges. Owned receipts pin the browser and node-machine addresses from
Docker-selected subnets.
No subnet ranges are hardcoded and no other projects are pruned.

Preparation starts its own digest-pinned PostgreSQL container and owns separate
named database and runtime-home volumes. It creates private random credentials once,
runs the existing Access migrations as the database owner, grants a separate runtime
role only application table DML/schema usage, and obtains the durable initial
administrator identity from Access. No independent user-role database is introduced.
Native configuration initializes only an empty owned volume; subsequent preparation
preserves native edits. A mismatched directory/database/volume owner is rejected.
The initialization mount disables Docker's image-to-volume copy so upstream home
directory skeletons are not mistaken for existing customer state.

The installation directory contains its identity/input manifest, Compose configuration,
controller state and private companion configuration. Keep the directory and volumes.
Only explicit runtime configuration files mount into the companion; database-owner
credentials and controller keys do not. OpenClaw receives neither. The local management
certificate is trusted by the companion. It is not installed in the workstation's trust
store. Its private key and the session-encryption key remain in the private directory.

Repeat preparation with the same input to reuse completed state. Existing configuration
edits and partial TLS material are rejected without replacement. The private certificate
includes `host.docker.internal`; management uses the published host port to preserve
native client-address attribution. Preparation and an identical second run passed
against fresh local Docker/Postgres resources. Tests cover retained keys, foreign state
and database privilege denials. Controller staging errors require operator inspection.
Preparation never runs database migrations on API startup.

The [unified CLI](installation.md#optional-capabilities) additionally initializes
selected model/Connections credentials and native pack members. The lower-level
component commands below do not implicitly activate Connections.

## Optional Connections

The installer registers optional Connections with its selected cloud service. The
lower-level deployment input accepts the resulting endpoint and private management key:

```json
{
  "connections": {
    "mode": "external",
    "brokerUrl": "https://cloud.clawscarf.com/api/connections",
    "managementKeyFile": "/absolute/private/management-key"
  }
}
```

The runtime credential is supplied separately. Provider credentials and catalog data
remain in the cloud. The companion exposes only the authenticated native-page adapter;
no broker schema, provider adapter, account page or maintenance loop runs locally.

The endpoint must use HTTPS with a DNS hostname and no credentials, query or fragment.
An optional `caFile` supplies a private CA; omit it for public trust. Preparation retains
endpoint/trust material and the management key privately, and adds the exact destination
to the OpenShell policy. Ordinary startup preserves these inputs. Explicit settings
changes enable or disable Connections without replacing its cloud registration.

### Activate Connections

The unified installer delivers the registered runtime credential automatically. The
component operator can also explicitly deliver a broker-issued credential; it never
mints an administrator session or bypasses native access checks.

Stop the installation, then start only its private controller:

```sh
docker compose -f .local/my-team/compose.json up -d controller
```

For an installation created through `configure`, change Connections using
`clawscarf configure --directory /absolute/my-team --connections` or
`--no-connections`. The installer handles its scoped cloud credential.

Configuration requires stopped, verified compute and exclusive access to its owned
home volume. It retains the expected credential privately outside the companion's
mount, transfers it through stdin, and uses OpenClaw's configuration SDK to change
only the Connections package/endpoint settings. It preserves unrelated edits and
an explicitly disabled plugin. The runtime launcher loads the scoped token and
optional CA on its next start; shared provider keys stay outside OpenClaw.

An interrupted change blocks ordinary startup. `observe` reads a read-only home
mount and never repairs state. Inspect its result, then deliberately rerun
`configure` with the current token to complete the change; no automatic rotation or
mutation replay occurs. Use normal `start` afterward; it reuses the controller.
Observation uses OpenClaw's public core-only snapshot validation to inspect stored
Connections settings without loading plugin metadata or creating SQLite sidecars.
The pinned SDK regression verifies unchanged initialized and configured read-only
homes, matching source-file hashes and refusal of invalid native core settings.
Configuration changes retain full native validation. Observation does not load the
package or establish that the running Gateway has accepted those settings.

These commands configure retained state; their success does not establish that an
external account is connected or that a native tool call has succeeded.
The [image-only native test](../images/README.md#verified-limits) verifies the packaged
credential, trusted TLS and native search path after restart. Local assembly's full
broker-account journey remains unchecked in [TODO.md](../../TODO.md).

## Shared browser

The optional `browser` input composes the [Chromium image](../execution/browser/README.md)
with the [fixed browser relay and public-web proxy](../execution/network/README.md):

```json
{
  "relayImage": "sha256:<built-relay-image-id>",
  "browser": {
    "image": "sha256:<built-browser-image-id>",
    "egressImage": "sha256:<built-egress-image-id>",
    "nodeImage": "sha256:<built-native-browser-node-image-id>",
    "dnsImage": "sha256:<built-browser-dns-image-id>",
    "port": 19282
  }
}
```

Replace each placeholder with its exact built digest. The relay port must be distinct
from every other listener. Setup generates a private CDP credential and a separate
owned browser-state volume. Chromium joins only an isolated internal network. The
relay publishes only browser CDP on loopback for operator readiness. The separate
native browser node reaches Chromium directly on the isolated browser network. Squid is unpublished
and accepts only the browser's reserved address. It permits public HTTP/HTTPS and
blocks private destinations. This is not a domain allowlist: authorized browsing
can transmit team data to public sites.

OpenClaw receives a private `team` remote-browser profile, not provider or controller
credentials. Native browser selection remains configured through the browser node;
application tool policies and native role restrictions still apply. Browser profiles,
cookies and logins belong to the trusted team. Stop/start retains that volume.
Startup verifies authenticated CDP readiness before OpenClaw, then enrolls and waits
for the [native browser node](../execution/browser-node/README.md#operator-lifecycle)
before starting application access. The node uses a scoped native credential and
private certificate-pinned TLS; its DNS resolver has a separate restricted source rule.
Compose owns the node, ingress, resolver and browser processes. The CLI stops them, retaining
owned volumes. The team runtime keeps its OpenShell restrictions.

The shared `relayImage` is required exactly when the browser is configured.
It supplies the fixed CDP readiness relay and private node ingress. It carries
no SSH listener. Ordinary browsing still has the
[owner-managed upstream issue](../execution/browser-node/README.md#upstream-browser-routing-bug).

## Initial model setup

The optional `models` field in the local input composes model configuration, a scoped
runtime credential and its exact network permission before the first Gateway start:

```json
{
  "models": {
    "configurationFile": "/absolute/path/to/models.json",
    "runtimeKeyFile": "/absolute/path/to/runtime-key",
    "caFile": "/absolute/path/to/model-gateway-ca.pem"
  }
}
```

Merge this field into the input above. `configurationFile` uses the existing
[model configuration](../models/README.md); select an enabled default model.
`runtimeKeyFile` contains a runtime-scoped gateway key, never its master key or a shared
provider key. `caFile` contains an explicit CA or self-signed trust certificate; omit it for a gateway signed by a public CA. Use an HTTPS
DNS endpoint reachable from the runtime—for a workstation gateway,
`https://host.docker.internal:PORT/v1`, not host loopback. Operating the optional
LiteLLM companion and issuing its scoped key remain separate operator steps.

Preparation validates these files before allocating Docker resources. It snapshots
initial model material privately, derives the [private runtime policy](../../scripts/deployment/policy.ts) from the
shipped policy and allows only the Node executable to reach that exact gateway
host/port. TLS passes through the policy proxy; Node still verifies the gateway
certificate. First initialization atomically writes the scoped credential in
the [private credential file](../../runtime/initialize.ts) and the optional public CA under `ca.pem`.
Native configuration references the credential file; Access never receives that key.
The runtime retains the controller's CA trust when adding a private model CA.

Repeat `prepare` requires the original model configuration/key/CA files with unchanged
contents. `start` consumes persisted state without rereading those source files.
Neither command overwrites later native model, credential or policy edits. Use the
explicit model configuration commands to change an existing installation. Omitting
`models` keeps provider-free startup and deny-by-default outbound policy.
A fresh image/volume passed this integrated path: protected administrator login,
configured model selection, real model response and native file-read execution without
subsequent model or network-policy commands. OpenShell reported the exact Node-only
gateway policy effective. A deliberate native model-name edit, conversation and browser
session survived repeat preparation and CLI stop/start with the compiled operator.
Regression tests cover invalid inputs, private credentials, unchanged-input requirements
and atomic initialization failures. Release-artifact clean-machine acceptance remains open.

## Run and stop

### Team runtime

New installations have one OpenShell runtime. Native file tools, shell commands,
Lobster and other local plugins use the same persistent home. There is no `execution`
input, SSH transport, worker image or worker volume. The Gateway launcher and default
agent both use `/home/node/.openclaw/workspace`. Per-agent workspaces remain native
configuration and are visible to local tools on the same filesystem.

Do not reapply the fresh preset over native configuration on normal restart.
Only the current contract is supported; there is no worker compatibility or transition path.

### Service lifecycle

The [installation CLI](installation.md) starts Compose services, creates or resumes
the owned OpenShell runtime, and verifies readiness before returning. Docker owns
the controller, forwarding and companion service lifetimes. Closing the terminal
does not stop them; use `clawscarf stop`. Stop retains owned volumes. No ClawScarf
host daemon, control socket or launchd job is installed.

The controller alone has the Docker socket and server signing key. Its state
directory is mounted at the identical absolute path because Docker resolves the
extracted supervisor path on the host. Forwarders use the pinned Linux CLI and
OpenSSH, read-only client credentials and loopback-only published ports. They have
no Docker socket or server signing key.

Startup checks native and Access health. Administrator setup remains pending until
the administrator completes the private OIDC claim and native authority is verified.
Initial native team setup applies once; uncertain mutations are not silently replayed.
Interrupted startup retains already-started services and data for inspection, an
explicit stop or resumed start.

Runtime observation reads every inventory page. Incomplete or repeated pages cannot
establish absence and trigger allocation. Creation intent is stored before allocation;
a lost response can be reconciled only to its owned runtime UUID. An uncertain absent
result, foreign/replaced runtime or terminal error requires inspection. Native
start/stop use names; UUID checks detect replacement but are not an atomic precondition.

Before admitting application access, startup checks the uniquely labeled Docker
container's actual immutable image and exact owned writable home volume. Missing,
duplicate, foreign or shadowing mounts fail visibly. These are point-in-time checks,
not continuous monitoring. The [binding regression](../../tests/deployment/runtime-binding.test.ts)
covers these failures; its optional real check uses
`CLAWSCARF_TEST_LOCAL_BINDING_DIRECTORY` with an owned installation.

`clawscarf logs --help` lists the Compose services. Failed subprocess diagnostics
retain allowlisted exit status, signal, timeout or spawn codes, excluding arguments,
environment and raw output. If network allocation fails, inspect Docker address
pools and this installation's recorded intents before resuming. PostgreSQL failures
report their own stage; they are not inferred from Docker error wording.

## Runtime upgrade

The `upgrade` command replaces stopped compute while retaining its named home volume.
Replacement and interruption/resumption have component regressions. Live acceptance
has not been rerun with the current team runtime. This is a local operator path,
not a qualified cross-platform release upgrade.
It requires an exact replacement image with the ClawScarf startup gate and the pinned
Python SDK environment from [pack setup](../../packs/README.md). It does not upgrade
the controller, companion or database, and it does not back up or roll back data.

Stop the installation, then start only its private controller:

```sh
docker compose -f .local/my-team/compose.json up -d controller
```

For an installation created through `configure`, run the explicit replacement with
its installation directory (not the private state folder):

```sh
pnpm clawscarf upgrade --directory /absolute/my-team \
  --runtime-image sha256:REPLACE_WITH_EXACT_IMAGE_ID \
  --python /absolute/operator-python/bin/python --yes
```

The command records current controller policy, typed settings, provider bindings and
runtime specification privately before deletion. It verifies the old compute is absent
and the same owned volume remains, then creates one replacement with OpenClaw startup
gated. Settings are restored before compute stops and its gate marker is published.
The next normal start boots the supervisor with restored settings before OpenClaw.
Compute ends stopped; use normal `start` for administrator
verification. Update the original input file's runtime image if repeating `prepare`.
Native configuration, identities and workspaces are not initialized again.

An interrupted upgrade blocks ordinary preparation/start. Resume the same command and
exact image; recorded deletion/allocation requests are observed, never blindly replayed.
Settings resume skips exact typed matches and writes only still-unset values; observed
conflicting values require inspection. The pinned setting-update API has no atomic
revision precondition: exclusive operator control is required throughout replacement
and resumption. Existing provider records remain live external authority; the command
preserves their bindings, not a private copy of provider credentials. The current native delete API
has no atomic UUID precondition; keep exclusive operator control during this local
procedure. It rejects changed bindings, custom canonical commands, unloaded policy,
and global overrides before destructive work. Global settings hide sandbox-local
values in this pinned API, so their upgrade cannot safely use effective readback alone.
No rollback promise follows from retaining a volume that the new runtime can modify.

The operator uses the pinned SDK's generated public protobuf RPCs for current policy,
typed settings and creation. It does not read controller databases or private SDK
client attributes. Controller keys and upgrade snapshots remain in the operator's
private directory, outside the runtime image.

## Upgrade acceptance

Use a disposable stopped installation with its controller running and no previous
upgrade. The replacement image must already be built. This test deliberately kills
its own upgrade process before settings restoration, resumes the same replacement,
and verifies retained home/configuration and a stopped result:

```sh
CLAWSCARF_TEST_LOCAL_UPGRADE_DIRECTORY=/absolute/disposable-installation \
CLAWSCARF_TEST_LOCAL_UPGRADE_IMAGE=sha256:REPLACE_WITH_EXACT_IMAGE_ID \
CLAWSCARF_TEST_LOCAL_UPGRADE_PYTHON=/absolute/operator-python/bin/python \
  pnpm exec tsx --test tests/deployment/upgrade-live.test.ts
```

Run the bridge protocol regressions with the same pinned Python environment:

```sh
/absolute/operator-python/bin/python -m unittest discover -s tests/deployment -p 'upgrade_rpc_test.py'
```

The current unit regressions cover retained configuration/volume ownership, gated
startup and interrupted replacement without another allocation. Live replacement of
the current team runtime, changed-upstream-version compatibility, browser interaction
after replacement, Linux and upgrades from published release artifacts remain unqualified.

## Allocation acceptance

Use a disposable prepared installation with no runtime or recorded create attempt.
Start only its controller, then run the explicitly enabled test:

```sh
CLAWSCARF_TEST_LOCAL_ALLOCATION_DIRECTORY=/absolute/path/to/disposable-installation \
  pnpm exec tsx --test tests/deployment/allocation-live.test.ts
```

The test holds the installation lock, requires an empty controller inventory, kills
its own child setup process after the real creation response, and verifies exact-UUID
resumption before stopping the runtime. It leaves the controller, private records
and volumes for inspection. Stop the controller explicitly afterward. It refuses an
existing runtime or previous create attempt; ordinary test runs skip this test.

Network regression tests cover foreign/replaced/duplicate networks, failed observation,
private intent/receipt integrity and uncertain allocation without replay. Live preparation
reconciled two deliberately preallocated owned bridges on this workstation, then started
Compose and OpenShell using them. A separate attempted allocation failed before any
installation volume or container was created; setup reported an uncertain network outcome
without interpreting Docker's error text. The workstation's default address pools were
unavailable, so successful default-pool allocation remains environment-dependent; the
live owned-network test used explicitly chosen, nonoverlapping test subnets.

## Team profile

A new installation can include a `team` block in the same input file. This configures
company OIDC and direct HTTPS on the Access companion; it does not create an identity
provider. Existing local identities cannot silently become team identities. Platform
support remains macOS arm64 with Docker Desktop while Linux qualification is open.

```json
{
  "origin": "https://team.example.com:18443",
  "widgetOrigin": "https://widgets.example.com:18444",
  "certificateFile": "/absolute/fullchain.pem",
  "keyFile": "/absolute/private-key.pem",
  "issuer": "https://identity.example.com/realm",
  "clientId": "clawscarf",
  "clientSecretFile": "/absolute/oidc-client-secret",
  "administratorSubject": "exact-subject-for-this-client",
  "administratorEmail": "admin@example.com"
}
```

For a loopback-only OIDC installation, use `http://127.0.0.1:<port>` origins and omit
`certificateFile` and `keyFile`. Docker publishes both listeners only on loopback;
the identity provider still uses HTTPS. Public or LAN HTTP is rejected.

Put that object at `team`, alongside the existing setup inputs. Set
`ports.application` and `ports.widgets` to the respective origin ports (443 when
omitted). Both DNS names must resolve to this host and be covered by the supplied
certificate. Supply its full chain and matching key. The key and OIDC secret must
be private regular files owned by the operator. Preparation validates material before
allocation, copies it into the private installation directory and refuses conflicting
files on resume. Certificate renewal/reconfiguration requires an explicit operating
procedure; this profile does not implement automatic issuance or renewal.

Register `https://team.example.com:18443/_clawscarf/callback` and
`https://team.example.com:18443/_clawscarf/signed-out` with the provider. It must emit
an email and `email_verified: true`; the administrator subject must be the exact
`sub` returned to this client. No first-login takeover is used.

Only application and widget ports publish on all IPv4 interfaces. Management,
Postgres, controller and native forwarding remain on loopback. Browser TLS and
private management TLS use separate keys. Set firewall rules for the intended
clients; this operator does not configure the host firewall or DNS.

`prepareLocal` initializes the configured OIDC administrator and matching native identity.
Foreground startup checks service availability through private management TLS and
reports the application URL. It does not claim to have
verified the administrator through OIDC. The unified installer can instead reserve an
unclaimed administrator and supply the [private setup link](installation.md#terminal-installer). Company login, native preparation and
member enrollment use the existing Access service and People page; no RawClaw service
is involved. TLS transport tests cover trusted/untrusted certificates on both listeners and a
private management probe whose public routing Host differs from its certificate name.
The native [Account and People plugin](../../plugins/access/README.md) owns team management;
its backend observes preparation requirements and current native authority. Login and
revocation also have assembled Dex/TLS acceptance against the pinned OpenClaw runtime:

- A renewed administrator session and the other person’s revocation survived restarting
  the runtime, companion and PostgreSQL.
- A fresh browser opened a native settings bookmark, completed OIDC login and returned
  to the exact path and query. The native settings page rendered at desktop and mobile sizes.
- A native dashboard widget rendered through the separate HTTPS widget origin. Its
  nested frame handled a button click and could not read the application document.
- An explicitly published `/hooks/wake` POST rejected missing/incorrect native tokens
  and accepted the correct token without browser login. Unpublished paths and wrong
  methods stayed protected; the widget origin rejected the companion session endpoint.

This test used an explicit private test certificate trust in the companion and browser,
with hostnames resolved locally. It does not qualify public DNS, certificate renewal,
a customer's IdP configuration or browser execution inside the sandbox. The access
path was locally qualified on the previous execution model. Explicit native-node
browsing also passed; ordinary model-selected routing and release qualification
remain open.
A native configuration reload can briefly make management reads unavailable; a failed
command is never automatically replayed.

### Native webhook acceptance

The opt-in [live regression](../../tests/access/hooks-live.test.ts) requires a disposable
team installation with native hooks enabled and only `/hooks/wake` explicitly published
in `runtime.webhookPaths`. It sends one authenticated wake event in `next-heartbeat`
mode; use a test installation. Keep the native hook token in a private file. Supply
`CLAWSCARF_TEST_HOOK_ORIGIN`, `CLAWSCARF_TEST_WIDGET_ORIGIN` and
`CLAWSCARF_TEST_HOOK_TOKEN_FILE`, then run
`pnpm exec tsx --test tests/access/hooks-live.test.ts`. For private test certificates,
set `NODE_EXTRA_CA_CERTS` to their explicit trust file; never disable TLS verification.
Missing inputs skip the test. Native hook configuration and ingress publication are
separate deliberate operator settings; see [hook routing](../../services/access/README.md#security-and-state).
