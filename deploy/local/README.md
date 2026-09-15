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
are not part of this local profile. The normal Access service retains its separate
[company OIDC configuration](../../services/access/README.md#configuration-and-operation).
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

Start the prepared installation:

```sh
pnpm exec tsx scripts/local.ts start --directory .local/my-team
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
