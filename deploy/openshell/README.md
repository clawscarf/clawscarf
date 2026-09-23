# Runtime boundary

ClawScarf uses OpenShell's Docker driver. Its host-side gateway owns
the container; Compose companions do not start a second copy of OpenClaw.
Controller access uses mTLS. The application receives neither controller keys nor
a Docker socket.

[policy.yaml](policy.yaml) gives the process UID/GID 1000, read-only application
software and a writable home/workspace. Landlock is a hard startup requirement.
Egress requires configured policies, including the recipe’s optional public-web
rule described below. No provider credentials are baked into the
[image](../images/Dockerfile).
The [image inventory](../images/README.md) and [runtime launcher](../../runtime/README.md)
own packaged tools, native registration and temporary-file configuration.
Read-only cgroup and CPU metadata let Node inspect its actual resource limits.

OpenShell's own supervisor is privileged during setup and then confines the
application process. This is not an unprivileged container supervisor or protection
against an administrator of the Docker host. One runtime serves one trusted team.
Whole-runtime confinement does not isolate shell execution from the Gateway's
own loopback listener. Team code is trusted with Gateway authority; native browser
execution and release qualification have the limits below.

The runtime's `/home/node` needs its own named volume. It includes OpenClaw state,
workspaces, native credentials, extensions and browser state. The image's
`/workspace` is not the durable OpenClaw workspace. OpenShell stop/start retains
compute; replacing compute must explicitly reattach the application volume.
The [deployment data map](../deployment/README.md#stored-data-and-credentials) owns
controller and companion persistence. Retention is not backup or rollback.

The [component manifest](../../release/components.json) records exact candidates.
Download hashes were checked against upstream release checksums. The recipe and
policy are ClawScarf integration configuration, based on the documented
[Docker driver](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/docs/reference/sandbox-compute-drivers.mdx)
and [policy schema](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/docs/reference/policy-schema.mdx).
Do not use a development build tag as a published release reference.

## Public web access

The recipe’s `defaults.publicWeb` becomes the installation’s editable `publicWeb`
choice; omitted recipe values are false. The Team server recipe enables it.
[Installer controls](../deployment/installation.md#public-web) own its CLI/menu usage.

The [public-web policy](../../scripts/deployment/public-web.ts) adds public IPv4
and global IPv6 destinations on ports 80/443 to OpenShell’s existing explicit
proxy. Private, loopback, link-local, metadata and reserved address ranges are
excluded. On ports 80/443, configured inference/Connections endpoints use the
same public-address constraints: the pinned OpenShell rejects overlapping rules
with different `allowed_ips`, even when their binary selectors differ. Private
services on those ports require public web to be off; services on other ports
retain their explicit rules (including the bundled private model gateway on 4000).
Setup and selected reconfiguration check DNS compatibility before writing service
settings. Startup then tests each configured service's actual CONNECT route from
inside OpenShell before opening Access. Host DNS alone is not treated as proof of
runtime connectivity. These checks establish the proxy route, not service
credentials, TLS trust or inference success. The controller resolves destination
names and enforces `allowed_ips`.
TLS passes through without interception; the rule allows TCP tunnels on those
ports, not a payload-level guarantee that every byte is HTTP. It grants neither
raw outbound sockets nor direct DNS. Tools must honor the proxy environment;
[the launcher](../../runtime/README.md) configures native OpenClaw and Node clients.

Enabling public web lets team code send data to public services. It does not isolate
team members or prevent data export. Turning it off removes ClawScarf’s
`public_web` rule and undoes only its recorded, unchanged endpoint adjustments.
The [private adjustment record](../../scripts/deployment/policy.ts) stores those before/after values;
equality with our address list alone never establishes ownership. Operator edits
are preserved. Connections-only changes leave model rules untouched. Overlapping
custom restrictions cause an explicit error before service settings are written.
Retained changes use the [same composition](../../scripts/deployment/public-web.ts)
as initial setup. The [updater](../../scripts/deployment/network-policy.ts) records
the reviewed values of changed rules, preserves unrelated rules, and refuses to
overwrite a selected rule changed since review. It reconciles a lost update response
by observing OpenShell and waits for effective activation before reopening access. Native dashboard/widget grants remain OpenClaw-owned and apply in the
user’s browser; inline previews do not inherit a saved dashboard’s network grants.

The opt-in [public-web regression](../../tests/runtime/public-web.test.ts) creates
and deletes an isolated sandbox. With the controller XDG directories selected,
run it with `CLAWSCARF_TEST_PUBLIC_WEB=1`, `CLAWSCARF_TEST_OPENSHELL` set to the
pinned CLI, `CLAWSCARF_TEST_GATEWAY` to the controller name and
`CLAWSCARF_TEST_RUNTIME_IMAGE` to the exact runtime image:

```sh
node --import tsx --test tests/runtime/public-web.test.ts
```

It creates the combined public-web and Connections policy, checks public HTTP/HTTPS
through Node and OpenClaw’s native guarded fetch, denies private destinations,
and verifies that removing public web preserves the configured Connections endpoint
while denying other public access. The release’s
[platform test](../../tests/deployment/platform-live.test.ts) also starts a fresh
installation with both capabilities enabled. It does not qualify every CLI’s
proxy support or the browser’s dashboard rendering.

## Contributor controller setup

The following commands have been exercised on macOS arm64 with Docker Desktop.
They are component-level development commands, not the finished installer. Use
the CLI and gateway archives recorded in the component manifest; verify each
archive's SHA-256 before extracting its executable. For installation-level platform
support, see the [installation guide](../deployment/installation.md).

From the repository root, with its Node/pnpm dependencies installed:

```sh
node --import tsx scripts/controller.ts init \
  --directory .local/controller \
  --gateway /absolute/path/to/openshell-gateway \
  --cli /absolute/path/to/openshell \
  --name clawscarf --port 17671
```

Initialization refuses an existing directory. It uses OpenShell's own PKI generator,
stores certificates and signing keys privately, registers the mTLS endpoint and
writes the documented Docker-driver configuration. It never disables TLS validation
or gives the application a Docker socket. The unified installer renders a Compose
controller service using the pinned upstream gateway image, with a loopback published
mTLS endpoint. Its state stays in the selected directory. No new identity or certificate
is generated on restart. For a prepared installation, start just the controller with
`docker compose -f <state>/compose.json up -d controller`. The host gateway executable
is used only for certificate generation during preparation, never as a resident process.
Inherited `OPENSHELL_*` overrides are rejected so another installation's settings
cannot silently replace this controller's TLS, authentication or endpoint configuration.

Select that isolated CLI configuration when using component commands:

```sh
export XDG_CONFIG_HOME="$PWD/.local/controller/config"
export XDG_STATE_HOME="$PWD/.local/controller/state"
export XDG_DATA_HOME="$PWD/.local/controller/data"
/absolute/path/to/openshell sandbox list --gateway clawscarf
```

Use native `sandbox stop` and `sandbox start` for retained compute. A sandbox in
OpenShell's terminal Error phase may require explicit replacement rather than start;
preserve and reattach its named volume. The current helper intentionally does not
delete failed compute or volumes automatically. The installation CLI coordinates
Access, native state initialization and model routing; these component commands
do not replace it.

## Application transport

The [controller composition](../../scripts/deployment/controller-compose.ts) runs
OpenShell's native `forward service` in separate application/widget services. It
forwards their native ports through authenticated gRPC to the protected runtime;
private Compose DNS lets Access reach them. Operator-facing published ports bind
host loopback. The forwarders mount only controller client configuration, not the
controller signing key. Replacing compute requires restarting its forwards.

The pinned controller's [connection admission](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/crates/openshell-server/src/grpc/sandbox.rs#L1313)
limits forwarded connections to 20 per sandbox. The service forward consumes a slot
for each application TCP connection, including long-lived streams. This is a
capacity limit for concurrent streams. [Access](../../services/access/README.md#security-and-state)
bounds ordinary HTTP concurrency and prevents stale connection reuse; WebSockets
still share the controller's connection limit.
The [installation test](../../tests/deployment/platform-live.test.ts) covers native
WebSocket forwarding and authenticated administrator access through the companion.
[Access verification](../../services/access/README.md#reuse-and-verification) covers
authenticated UI asset bursts, idle connections and membership changes.

[Deployment networking](../deployment/README.md#ownership-and-recovery) owns bridge
allocation and fixed service addresses. Public application/widget entry always goes
through [Access](../../services/access/README.md#security-and-state).

Probe Gateway health inside its application namespace:

```sh
/absolute/path/to/openshell sandbox exec --name clawscarf --gateway clawscarf \
  --env HOME=/home/node --env OPENCLAW_STATE_DIR=/home/node/.openclaw \
  -- /usr/local/bin/node /app/dist/docker-healthcheck.js
```

This is the unmodified upstream health probe; exit zero means the selected Gateway's
`/healthz` endpoint responds successfully. It does not prove a working model, login or
tool execution. OpenShell's `Ready` phase describes its sandbox, not application health.
The runtime image disables the upstream Docker `HEALTHCHECK`: Docker executes it in
the outer supervisor namespace, where it cannot reach the confined Gateway's loopback
listener. Do not treat Docker container status as Gateway readiness.

## Repeatable boundary and retention check

The opt-in [boundary test](../../tests/runtime/boundary.test.ts) uses the pinned CLI
and shipped policy against an already running, isolated Docker-driver controller.
Select its XDG directories as above and a locally built runtime image by its exact
Docker image ID:

```sh
export CLAWSCARF_TEST_RUNTIME_BOUNDARY=1
export CLAWSCARF_TEST_OPENSHELL=/absolute/path/to/openshell
export CLAWSCARF_TEST_GATEWAY=clawscarf
export CLAWSCARF_TEST_RUNTIME_IMAGE="$(docker image inspect clawscarf-runtime:local --format '{{.Id}}')"
pnpm exec tsx --test tests/runtime/boundary.test.ts
```

The test creates its own random `csb-*` sandbox and named home volume, runs a small
Node process with a 512 MiB/one-CPU limit, and deletes only those resources. It does
not initialize or edit an existing OpenClaw installation. A failed creation with
uncertain completion reports its exact name for inspection; cleanup never uses
`--all` or force-removes an attached volume.

Checks cover UID 1000, `no_new_privs`, actual cgroup memory/CPU limits, writable
scratch space, denied writes outside policy, and unavailable Docker/root-SSH
paths. An unavailable path establishes absence or denied visibility, not proof that
a secret was mounted and safely blocked. A disposable ordinary Docker container
first confirms a TCP connection to `1.1.1.1:443` works; the confined process must
receive a rejection, not merely time out. This sends no application payload or
credentials. An offline environment fails that prerequisite instead of producing a
false network-isolation pass.

A marker under the home volume survives native `sandbox stop`/`sandbox start`.
This proves retained-compute restart, not replacement/relink, backup restoration,
Gateway crash consistency, browser isolation or isolation between team members.
Exact candidate/platform results belong to [release evidence](../../release/README.md#release-evidence),
not a second support matrix here.

The [native runtime test](../../tests/runtime/team-runtime.test.ts) starts the real
Gateway in a separate disposable sandbox using the same controller and image:

```sh
CLAWSCARF_TEST_TEAM_RUNTIME=1 pnpm exec tsx --test tests/runtime/team-runtime.test.ts
```

After initial file-tool use, the test uploads
a text file through native chat, reads it with the native file tool, edits it using
Python and reads the result through native Lobster. It also checks an output-file
reference in chat, native PDF extraction, Lobster approval/resume without replay,
member shell/file/Lobster access and denial of an administrative RPC. Both shell and
Lobster children pass filesystem, controller-key, Docker-socket and egress-denial
checks. The uploaded and edited files survive OpenShell stop/start. Each run deletes
its own sandbox and volume.

The test derives role, workspace and execution settings from the shipped native
preset. Its model is a deterministic loopback fixture that requests real native tool calls.
The fixture permits shell execution with `tools.exec.mode: "full"`; the product
preset retains `"auto"`. These checks establish native execution and file placement,
not model quality, a real inference route, browser file transfer or a complete
installer/login journey. The member RPC check is an application permission check;
it does not make code execution safe against hostile teammates.

## Execution placement

The Gateway, native plugins, ordinary shell and local CLIs run together inside one
externally controlled OpenShell sandbox. OpenClaw inner sandboxing is off in the
fresh preset. This preserves the normal native plugin execution model, including
Lobster. Native application roles do not create an internal security boundary
against a teammate who can execute code. The [product contract](../../README.md)
owns the trust model.

The persistent home volume contains native state, uploads and agent workspaces.
There is no SSH worker or filesystem synchronization. Native upload storage may
use separate managed paths on that same volume; it is not a filesystem per chat.
Core commands and plugin children inherit OpenShell confinement. They can read
Gateway-local data and reach its loopback listener; they must still be denied host
private files, Docker/controller authority and undeclared external destinations.

The separate [browser integration](../execution/browser-node/README.md) owns its
controller policy, enrollment and Chromium placement. It retains the browser's own
sandbox because this OpenShell policy denies the namespace operations Chromium
needs. Consult that owner for current browser support.
