# Local assembly

This operator path assembles the existing components for local evaluation on macOS
arm64 with Docker Desktop. `prepare` initializes private configuration, the database
and native volume. `start` supervises the runtime and companions. Fresh startup, native administrator
browser login, a configured model/tool interaction and retained-state restart have
passed. The terminal wizard remains separate
and last.

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

```sh
pnpm exec tsx scripts/local.ts prepare \
  --directory .local/my-team --config /absolute/path/to/local-input.json
```

Preparation first reserves both actual Docker bridge networks using Docker's allocator:
one for companions and one for OpenShell. Each has installation/purpose labels and a
recorded exact ID. Compose consumes the companion network as external; OpenShell uses
its reserved runtime network. Startup verifies both IDs and ownership before starting
processes. This establishes allocated capacity, not a speculative count from Docker's
possibly absent address-pool metadata. It does not prove later service connectivity.

Network creation intent is recorded before allocation. If a response is lost, preparation
reconciles the matching owned network and records its ID. An absent network after a
recorded attempt remains uncertain and requires operator inspection; it is never
blindly allocated again. A partial setup retains its first network if reserving the
second fails. Foreign, unlabeled, replaced or ambiguous networks are rejected, not
adopted or deleted. No subnet ranges are hardcoded and no other projects are pruned.

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
certificate is trusted only by the companion, not installed in the workstation's trust
store. Its private key and the session-encryption key remain in the private directory.

Repeat preparation with the same input to reuse completed state. Existing configuration
edits and partial TLS material are rejected without replacement. The private certificate
includes `host.docker.internal`; management uses the published host port to preserve
native client-address attribution. Preparation and an identical second run passed
against fresh local Docker/Postgres resources. Tests cover retained keys, foreign state
and database privilege denials. Controller staging errors require operator inspection.
Preparation never runs database migrations on API startup.

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
initial model material privately, derives the [private runtime policy](../../scripts/local/models.ts) from the
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
session survived repeat preparation and foreground stop/start with the compiled operator.
Regression tests cover invalid inputs, private credentials, unchanged-input requirements
and atomic initialization failures. Release-artifact clean-machine acceptance remains open.

## Run and stop

Start the prepared installation with Node directly so terminal signals reach the
supervising process throughout cleanup:

```sh
node --import tsx scripts/local.ts start --directory .local/my-team
```

It runs in the foreground, starts the private controller, creates or resumes its owned
runtime, establishes standard SSH application/widget forwards and starts the companion.
It checks native health, then exercises local login and native administrator authorization
through the generated REST client. It prints the login URL and a fresh five-minute,
one-use code. The verification session is logged out after its check. In another terminal,
`pnpm exec tsx scripts/local.ts login --directory .local/my-team` issues a replacement code.
Initial native team preparation establishes the administrator profile and explicit role
once. Its pending/completed records prevent an uncertain change from being replayed
automatically. Later startup verifies access without reapplying those native settings.

Ctrl+C stops the companion, forwards, runtime, controller and database; the directory,
volumes and reserved networks remain. Process-group supervision also cleans up SSH children after a forward
exits. Companion/Postgres exits are monitored through Compose, and signal handling
remains active throughout cleanup. Only one foreground owner can run for an installation.
This is a local evaluation process, not a daemon/service installation or unattended
recovery system.

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
The [binding regression](../../tests/local/runtime-binding.test.ts) covers wrong
images, runtime labels, missing/duplicate containers, foreign/read-only home mounts
and incomplete observations. Its optional real Docker check uses
`CLAWSCARF_TEST_LOCAL_BINDING_DIRECTORY` with an existing owned installation.
Both that read-only check and normal startup through administrator verification
passed against the retained development runtime.

Private controller/forward logs are under `logs/` in the installation directory. Compose
owns companion/Postgres logs. If network reservation fails, inspect Docker's address
pools and this installation's recorded network intents before resuming. Setup does not
classify Docker error messages as proof of pool exhaustion. A failed PostgreSQL start
reports that separate stage and directs the operator to Compose status/logs. Port tests use actual loopback listeners;
retained Docker ownership/binding denials use structured fixtures. Repeated preparation
and startup also passed against the retained local installation with its actual
PostgreSQL listener and runtime volume.

Fresh preparation and startup passed with the actual companion, PostgreSQL and
OpenShell-hosted Gateway, including the Docker-host management route. Browser login
opened native OpenClaw with the configured administrator name. A name edited in
OpenClaw remained after foreground stop/start; the runtime UUID and browser session
were retained. The compiled operator also resumed that same installation successfully.
Controller-startup failure also stopped the database and released the
installation lock without deleting volumes. Tests additionally cover interrupted
native bootstrap, cancellation, process-tree cleanup and paginated discovery.

The configured administrator browser journey also passed a real model response and
native file-read tool through the optional gateway; see [model acceptance](../models/README.md#verification-and-provenance).
A [real-controller crash test](../../tests/local/allocation-live.test.ts) passed:
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

Stop the foreground installation. In one terminal, start only its private controller:

```sh
pnpm exec tsx scripts/controller.ts start --directory .local/my-team/controller
```

In another, run the explicit replacement:

```sh
pnpm exec tsx scripts/local.ts upgrade --directory .local/my-team \
  --runtime-image sha256:REPLACE_WITH_EXACT_IMAGE_ID \
  --python /absolute/operator-python/bin/python --yes
```

The command records current controller policy, typed settings, provider bindings and
runtime specification privately before deletion. It verifies the old compute is absent
and the same owned volume remains, then creates one replacement with OpenClaw startup
gated. Settings are restored before compute stops and its gate marker is published.
The next normal start boots the supervisor with restored settings before OpenClaw.
Compute ends stopped; stop the private controller and use normal `start` for administrator
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
  pnpm exec tsx --test tests/local/upgrade-live.test.ts
```

Run the bridge protocol regressions with the same pinned Python environment:

```sh
/absolute/operator-python/bin/python -m unittest discover -s tests/local -p 'upgrade_rpc_test.py'
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
  pnpm exec tsx --test tests/local/allocation-live.test.ts
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

`prepare` initializes the configured OIDC administrator and matching native identity.
`start` checks service availability through private management TLS, then prints the
People URL for company sign-in. It does not issue a local login code or claim to have
verified the administrator through OIDC. Company login, native preparation and
member enrollment use the existing Access service and People page; no RawClaw service
is involved. TLS transport tests cover trusted/untrusted certificates on both listeners and a
private management probe whose public routing Host differs from its certificate name.
The People page observes preparation requirements before enrollment; its desktop/mobile
interaction has controlled-response browser coverage. A fresh assembled deployment also passed browser acceptance with a separate Dex
v2.45.1 test provider, signed tokens, TLS and the actual pinned OpenClaw runtime:

- The configured administrator signed in and enabled native team access through People.
- An unenrolled identity was denied; after enrollment through People, it opened native
  OpenClaw with its own display name and member role.
- Native administrator promotion and handover changed current People permissions;
  the companion did not maintain a duplicate role assignment.
- Removing that person closed both open native tabs and invalidated the session.
  Removing the last usable administrator was rejected. Browser logout reached the
  signed-out page without automatic re-entry.
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
path is locally qualified; member execution and release qualification remain open.
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
