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
Public DNS, company login and external exposure
are not part of this local profile. An explicit [team profile](#team-profile)
assembles company OIDC and public TLS using the same operator.
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
adopted or deleted. An optional browser adds separate isolated browser and machine bridges. Owned receipts pin their
address and the relay address on the runtime network from Docker-selected subnets.
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
certificate is trusted by the companion and, when Connections is activated, the
Gateway. It is not installed in the workstation's trust
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

For a new installation, choose a local companion or a compatible external broker.
Neither option requires company OIDC. Local mode supplies the account UI and broker:

```json
{
  "connections": {
    "mode": "local",
    "projectId": "your-dedicated-project",
    "apiKeyFile": "/absolute/private/composio-key",
    "catalogDirectory": "/absolute/path/to/reviewed-catalog"
  }
}
```

Prepare a dedicated provider project and reviewed catalog using the
[Connections catalog commands](../../services/connections/README.md#configuration-and-catalog).
Configure the project's callback as the application's origin followed by
`/_clawscarf/connections/verify`. Local evaluation uses its loopback application
origin; team deployments use their HTTPS origin. Provider support for a chosen
callback must be verified independently.

Local preparation validates the key and complete catalog before allocating resources,
copies them into the private installation directory, applies the existing
Connections migrations with the database administrator and publishes the catalog.
Only the companion receives the provider key and catalog. The application database
login receives table DML, never schema ownership or migration authority. The runtime
broker endpoint is the prepared management HTTPS listener at
`https://host.docker.internal:<management-port>`, using its retained certificate.

External mode uses an existing compatible broker and its account-management UI:

```json
{
  "connections": {
    "mode": "external",
    "brokerUrl": "https://connections.example.com/team-broker",
    "caFile": "/absolute/path/to/broker-ca.pem"
  }
}
```

`brokerUrl` accepts an HTTPS DNS hostname, explicit port and optional base path;
credentials, query strings, fragments, IP addresses and `localhost` are rejected.
Use `host.docker.internal` for a broker on this workstation. A trailing slash is
removed consistently with the native plugin. Omit `caFile` for a public CA; otherwise
supply a regular certificate file, not a symbolic link. External mode reads no local
provider key or catalog, creates no Connections schema, mounts no Connections
configuration into the companion and exposes no local account actions. Account setup
and scoped runtime credential issuance belong to that external broker.

Both modes retain the endpoint and optional CA privately before resource allocation,
then add one exact Node HTTPS endpoint to the initial runtime policy. TLS passes
through OpenShell; Node still verifies the server certificate. Neither preparation
nor ordinary startup rewrites an authored policy. An explicit installation settings
change updates only the Connections rule at the next start. Repeating preparation retains matching
inputs; a changed endpoint, trust certificate, key or catalog requires explicit
[settings application](installation.md#change-an-existing-installation) rather than an implicit replacement. Omitting `connections` on initial preparation creates
no Connections schema, loads no provider and exposes no account actions.

The unified installer prepares and activates the scoped native credential. These
component operations also expose explicit credential delivery for operators. Endpoint
validation, retained configuration and native activation have tests; external-account
OAuth remains a separate journey.

### Activate Connections

For a local broker, sign in as a native administrator and use the
[credential command](../../services/connections/README.md#configuration-and-catalog)
to issue a private token file. An external broker supplies its own scoped token.
Setup does not mint an administrator session or bypass native access checks.

Stop the installation, then start only its private controller:

```sh
docker compose -f .local/my-team/compose.json up -d controller
```

Then apply the scoped credential and prepared broker endpoint:

```sh
pnpm clawscarf connections configure --state .local/my-team \
  --credential-file /private/connections-token --yes
pnpm clawscarf connections observe --state .local/my-team
```

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
with the [fixed runtime relay and public-web proxy](../execution/network/README.md):

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
credentials. With the execution worker configured, native sandbox defaults explicitly
allow that shared browser and explicitly add its native tool to sandboxed sessions;
other sandbox-tool denials and native role restrictions still apply. Browser profiles,
cookies and logins belong to the trusted team. Stop/start retains that volume.
Startup verifies authenticated CDP readiness before OpenClaw, then enrolls and waits
for the [native browser node](../execution/browser-node/README.md#operator-lifecycle)
before starting application access. The node uses a scoped native credential and
private certificate-pinned TLS; its DNS resolver has a separate restricted source rule.
Compose owns the node, ingress, resolver and browser processes. The CLI stops them, retaining
owned volumes. No Gateway/worker OpenShell restrictions are removed.

The shared `relayImage` is required exactly when worker or browser is configured.
It supplies the fixed readiness/SSH relay and private node ingress. Worker SSH uses
an exact-host OpenShell TCP policy; the Gateway has no direct browser CDP egress.
Initial native browser routing selects the uniquely named paired node. Native edits
are not overwritten at restart. Explicit node browsing works; ordinary model-selected
browsing still has the [owner-managed upstream issue](../execution/browser-node/README.md#upstream-browser-routing-bug).

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

### Separate execution worker

A new installation can include an `execution` block alongside its other inputs:

```json
{
  "relayImage": "sha256:REPLACE_WITH_RELAY_IMAGE_ID",
  "execution": {
    "image": "sha256:REPLACE_WITH_WORKER_IMAGE_ID",
    "port": 19222,
    "cpu": "1",
    "memory": "512Mi"
  }
}
```

Build the [worker image](../execution/worker/README.md) and use a distinct loopback
port. This path requires a rebuilt Gateway image containing both current volume
initializers. Worker component confinement, lifecycle and assembled native member/
administrator execution tests have passed on the local candidate. Browser use and
release qualification remain open.

Preparation creates a separate owned worker-home volume and worker-specific SSH
keys. The Gateway receives only the client private key and pinned host identity;
the worker receives only its host key and authorized client public key. Neither
gets controller credentials. The Gateway policy permits `/usr/bin/ssh` to reach
`runtime.clawscarf.internal:2222`; the fixed relay forwards to the operator-owned
worker listener. The worker starts with denied outbound traffic.

Vanilla OpenClaw uses its native SSH execution backend with all-session sandboxing.
Remote workspaces are seeded once, then remain canonical on the worker volume;
they are not synchronized back to Gateway files. Native `sandbox recreate` deletes
the selected remote workspace. Team members share the worker's Unix identity;
native role-required profiles still receive their own native directory scopes and
read-only agent inputs. Those directories are not hostile-user isolation.

Startup creates or resumes the worker under the same controller as the Gateway,
checks pinned SSH authentication and its actual image/volume binding, then starts
OpenClaw. Separate [allocation intent and UUID receipts](../../scripts/deployment/runtime.ts)
track the worker independently from the Gateway. Uncertain absent targets are not automatically recreated.
Shutdown stops the Gateway and worker before their controller; both volumes remain.
No worker is allocated when `execution` is omitted. Browser execution uses a
[separate browser component](../execution/browser/README.md); it is not enabled by
this block. Its ordinary model-selected routing limitation is documented there.

### Service lifecycle

The [installation CLI](installation.md) starts Compose services, creates or resumes the
owned OpenShell Gateway and worker, and verifies readiness before returning. Docker
owns the controller, SSH forwarding and companion service lifetimes; no ClawScarf host
supervisor, Unix control socket or launchd job is installed.

OpenShell's controller uses its upstream pinned gateway image, mTLS and the Docker
socket. It alone has Docker authority. Its state directory is mounted at the identical
absolute path because Docker resolves the extracted sandbox supervisor path on the host.
Forwarders use the pinned Linux CLI and OpenSSH, with read-only client credentials and
loopback-only published ports. They have no Docker socket or server signing key.

Startup checks native health and verifies local administrator authority. Initial native
team setup applies once; an uncertain mutation is never silently replayed. Company OIDC
setup stays pending until the administrator completes its private claim. Closing the
terminal does not stop services; use `stop`. Interrupted startup retains already-started
services and data, visible through status/logs, for an explicit stop or resumed start.

Runtime observation reads every inventory page; an incomplete or repeated page cannot
establish absence and trigger allocation. Creation intent is stored before allocation.
An interrupted request is reconciled to its
owned runtime UUID; an uncertain absent result is not automatically allocated again.
Foreign/replaced runtimes and terminal errors require inspection. Native start/stop use
names, so UUID checks before and after detect replacement but cannot provide an atomic
UUID precondition. The CLI cannot independently read the runtime's actual image through
its current `get` output; do not treat receipt metadata as that verification.
Before starting Access, the launcher therefore inspects the uniquely labeled Docker
container, compares its actual immutable image ID and checks the exact writable,
owned home-volume mount, rejecting additional mounts that shadow its contents.
Missing, duplicate or changed bindings stop startup;
failed observation is distinct from a verified mismatch. This is a read-only
Docker-driver check, not an atomic replacement precondition or continuous monitoring.
The [binding regression](../../tests/deployment/runtime-binding.test.ts) covers wrong
images, runtime labels, missing/duplicate containers, foreign/read-only home mounts
and incomplete observations. Its optional real Docker check uses
`CLAWSCARF_TEST_LOCAL_BINDING_DIRECTORY` with an existing owned installation.
Both that read-only check and normal startup through administrator verification
passed against the retained development runtime.

Docker retains controller, forwarder and application logs. `pnpm clawscarf logs --help`
lists the service names; the command reads Compose logs directly. Failed subprocesses retain allowlisted exit status, signal, timeout or spawn
error codes; arguments, environment, stdout and stderr are excluded from CLI errors.
If network reservation fails, inspect Docker's address
pools and this installation's recorded network intents before resuming. Setup does not
classify Docker error messages as proof of pool exhaustion. A failed PostgreSQL start
reports that separate stage and directs the operator to Compose status/logs. Port tests use actual loopback listeners;
retained Docker ownership/binding denials use structured fixtures. Repeated preparation
and startup also passed against the retained local installation with its actual
PostgreSQL listener and runtime volume.

Fresh preparation and startup passed with the actual companion, PostgreSQL and
OpenShell-hosted Gateway, including the Docker-host management route. Browser login
opened native OpenClaw with the configured administrator name. A name edited in
OpenClaw remained after CLI stop/start; the runtime UUID and browser session
were retained. The compiled operator also resumed that same installation successfully.
Controller-startup failure also stopped the database and released the
installation lock without deleting volumes. Tests additionally cover interrupted
native bootstrap, cancellation, process-tree cleanup and paginated discovery.

The configured administrator browser journey also passed a real model response and
native file-read tool through the optional gateway; see [model acceptance](../models/README.md#verification-and-provenance).
A [real-controller crash test](../../tests/deployment/allocation-live.test.ts) passed:
setup was killed after allocation acceptance and before saving its local receipt;
resumption recovered the same UUID without another create call. The normal launcher
then reached verified administrator access and the protected native browser UI with
models unconfigured. This tests lost local completion after acceptance, not every
possible failure inside Docker or OpenShell. A release-artifact clean-machine run
remains required. The selected member/browser
execution limitations still apply; see
[runtime placement](../openshell/README.md#execution-placement).

## Runtime upgrade

The `upgrade` command replaces stopped compute while retaining its named home volume.
Real replacement and interruption/resumption have passed on macOS arm64. This is a
local operator path, not a qualified cross-platform release upgrade.
It requires an exact replacement image with the ClawScarf startup gate and the pinned
Python SDK environment from [pack setup](../../packs/README.md). It does not upgrade
the controller, companion or database, and it does not back up or roll back data.

Stop the installation, then start only its private controller:

```sh
docker compose -f .local/my-team/compose.json up -d controller
```

Then run the explicit replacement:

```sh
pnpm clawscarf upgrade --state .local/my-team \
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

The real replacement retained native configuration and a workspace marker, blocked
Gateway startup before restoration, and resumed without another allocation. Normal
startup afterward verified administrator authority through Gateway. This check used
the same pinned OpenClaw version in a rebuilt runtime; it does not establish migration
compatibility with a different upstream version. Browser interaction after replacement,
Linux and upgrades from published release artifacts remain unqualified.

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
reports the application URL. It does not issue a local login code or claim to have
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
path and separate worker execution are locally qualified. Explicit native-node
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
