# Local assembly

This operator path assembles the existing components for local evaluation on macOS
arm64 with Docker Desktop. `prepare` initializes private configuration, the database
and native volume. `start` supervises the runtime and companions; its complete live
model/tool journey remains unverified. Fresh startup, native administrator browser
login and retained-state restart have passed. The terminal wizard remains separate
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

All ports must be distinct and free. Public DNS, company login and external exposure
are not part of this local profile. The normal Access service retains its separate
[company OIDC configuration](../../services/access/README.md#configuration-and-operation).
No AI or connection provider key is required by preparation.

```sh
pnpm exec tsx scripts/local.ts prepare \
  --directory .local/my-team --config /absolute/path/to/local-input.json
```

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

Ctrl+C stops the companion, forwards, runtime, controller and database; the directory and
volumes remain. Process-group supervision also cleans up SSH children after a forward
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
owns companion/Postgres logs. Docker needs capacity for both a companion network and an
OpenShell network. If its address pools are exhausted, inspect unused networks explicitly;
setup does not prune networks belonging to other projects.

Fresh preparation and startup passed with the actual companion, PostgreSQL and
OpenShell-hosted Gateway, including the Docker-host management route. Browser login
opened native OpenClaw with the configured administrator name. A name edited in
OpenClaw remained after foreground stop/start; the runtime UUID and browser session
were retained. The compiled operator also resumed that same installation successfully.
Controller-startup failure also stopped the database and released the
installation lock without deleting volumes. Tests additionally cover interrupted
native bootstrap, cancellation, process-tree cleanup and paginated discovery.

Model/tool execution, allocation interrupted against the real controller, and a
release-artifact clean-machine run remain required. The selected member/browser
execution limitations still apply; see
[runtime placement](../openshell/README.md#execution-placement).
