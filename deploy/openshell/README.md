# Runtime boundary

The current candidate uses OpenShell's Docker driver. Its host-side gateway owns
the container; Compose companions do not start a second copy of OpenClaw.
Controller access uses mTLS. The application receives neither controller keys nor
a Docker socket. This arrangement is under qualification, not a released guarantee.

[policy.yaml](policy.yaml) gives the process UID/GID 1000, read-only application
software and a writable home/workspace. Landlock is a hard startup requirement.
Egress is denied until explicit endpoint policies are configured; no provider
credentials are baked into the [image](../images/Dockerfile).
The image bundles the built [Connections plugin](../../plugins/connections/README.md)
at `/app/clawscarf/connections`; native registration and the optional broker binding
are installation configuration, not baked customer state. Unconfigured Connections
exposes no executable tools.
The image sets `SQLITE_TMPDIR=/tmp`: native SQLite maintenance needs writable
temporary files, and `/var/tmp` is outside the permitted filesystem paths.
Read-only cgroup and CPU metadata let Node inspect its actual resource limits.

OpenShell's own supervisor is privileged during setup and then confines the
application process. This is not an unprivileged container supervisor or protection
against an administrator of the Docker host. One runtime serves one trusted team.
Whole-runtime confinement does not isolate shell execution from the Gateway's
own loopback listener. Native member execution needs a separate sandbox boundary;
the standalone team execution configuration is not qualified yet.

The runtime's `/home/node` needs its own named volume. It includes OpenClaw state,
workspaces, native credentials, extensions and browser state. The image's
`/workspace` is not the durable OpenClaw workspace. OpenShell stop/start retains
compute; replacing compute must explicitly reattach the application volume.
Controller identity/state and companion state also need retention. No backup or
rollback feature is implied.

The [component manifest](../../release/components.json) records exact candidates.
Download hashes were checked against upstream release checksums. The recipe and
policy are ClawScarf integration configuration, based on the documented
[Docker driver](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/docs/reference/sandbox-compute-drivers.mdx)
and [policy schema](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/docs/reference/policy-schema.mdx).
Do not use a development build tag as a published release reference.

## Contributor controller setup

The following commands have been exercised on macOS arm64 with Docker Desktop.
They are component-level development commands, not the finished installer. Use
the CLI and gateway archives recorded in the component manifest; verify each
archive's SHA-256 before extracting its executable. Other platforms are unqualified.

From the repository root, with its Node/pnpm dependencies installed:

```sh
node --import tsx scripts/controller.ts init \
  --directory .local/controller \
  --gateway /absolute/path/to/openshell-gateway \
  --cli /absolute/path/to/openshell \
  --name clawscarf --port 17671
node --import tsx scripts/controller.ts start --directory .local/controller
```

Initialization refuses an existing directory. It uses OpenShell's own PKI generator,
stores certificates and signing keys privately, registers the mTLS endpoint and
writes the documented Docker-driver configuration. It never disables TLS validation
or gives the application a Docker socket. `start` runs in the foreground; a service
manager can supervise that same command. Controller state stays in the selected
directory. No new identity or certificate is generated on restart.
Inherited `OPENSHELL_*` overrides are rejected so another installation's settings
cannot silently replace this controller's TLS, authentication or endpoint configuration.

In another terminal, select that isolated CLI configuration:

```sh
export XDG_CONFIG_HOME="$PWD/.local/controller/config"
export XDG_STATE_HOME="$PWD/.local/controller/state"
export XDG_DATA_HOME="$PWD/.local/controller/data"
/absolute/path/to/openshell sandbox list --gateway clawscarf
```

Use native `sandbox stop` and `sandbox start` for retained compute. A sandbox in
OpenShell's terminal Error phase may require explicit replacement rather than start;
preserve and reattach its named volume. The current helper intentionally does not
delete failed compute or volumes automatically. Access-companion configuration,
native state initialization and model routing have their own owners and still need
the combined clean-install qualification in the plan.

## Application transport

Expose the native application and widget listeners to the access companion using
OpenShell's standard SSH port forwarding. With the isolated CLI configuration above
and an existing sandbox named `clawscarf`, run each command in a supervised terminal:

```sh
/absolute/path/to/openshell forward start 18789 clawscarf --gateway clawscarf
/absolute/path/to/openshell forward start 18790 clawscarf --gateway clawscarf
```

These listeners bind host loopback. The first reaches OpenClaw; the second reaches
its separate widget sandbox. Each command remains running for the lifetime of its
forward. Stop the process to close its listener; restart forwards after replacing
compute. They neither initialize state nor replace session authorization.
The access companion targets these host listeners through `host.docker.internal`
on Docker Desktop. Linux host routing needs separate qualification.
Public application access and the widget origin go through the
[access companion](../../services/access/README.md), never directly to these listeners.

Standard forwarding multiplexes application TCP connections over one SSH transport
per listener. Forty concurrent native CSS requests pass through the application
companion without truncation. The alternative `forward service` command consumes
one controller forwarding slot per application TCP connection; the pinned controller
limits that path to 20 simultaneous connections per sandbox, which can reject a
normal browser's assets and streams. Do not use it as application ingress.
The implementation is upstream
[standard forwarding](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/crates/openshell-cli/src/ssh.rs#L336),
with the controller limit in
[connection admission](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/crates/openshell-server/src/grpc/sandbox.rs#L1432).

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
scratch space, denied writes outside policy, and unavailable Docker/controller-key
paths. An unavailable path establishes absence or denied visibility, not proof that
a secret was mounted and safely blocked. A disposable ordinary Docker container
first confirms a TCP connection to `1.1.1.1:443` works; the confined process must
receive a rejection, not merely time out. This sends no application payload or
credentials. An offline environment fails that prerequisite instead of producing a
false network-isolation pass.

A marker under the home volume survives native `sandbox stop`/`sandbox start`.
This proves retained-compute restart, not replacement/relink, backup restoration,
Gateway crash consistency, browser isolation or isolation between team members.
The current run passed on macOS arm64/Docker Desktop with OpenShell 0.0.116 and
its Docker driver. Other platforms remain unqualified.
