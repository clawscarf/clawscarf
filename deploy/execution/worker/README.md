# Shared execution worker

This image supplies an ordinary SSH endpoint for vanilla OpenClaw's native SSH
sandbox backend. An operator runs it as a separate OpenShell sandbox with its own
persistent home. Agent commands share one team-owned Unix account; they cannot
access the Gateway's loopback listener, home, controller credentials or sockets.
This does not provide isolation between people in that team.

The recipe contains Node, Python, Git, OpenSSH and the GNU filesystem utilities
required by the native backend. It contains no OpenClaw application, customer
configuration or generated credentials. Its OpenClaw build stage supplies only the
reviewed network-tool payload; no OpenClaw application is copied into the worker.

## Image and identity

Build from the repository root:

```sh
docker build -f deploy/execution/worker/Dockerfile -t clawscarf-ssh-worker:local .
```

Deploy an exact image digest/ID. [policy.yaml](policy.yaml) leaves process identity
to the Docker image's explicit `USER node` (UID/GID 1000), including its supplementary
groups. Explicit numeric policy overrides in the pinned supervisor can retain the
supervisor's supplementary groups; do not substitute them. `/workspace` is the
OpenShell workspace; `/home/node` is the separately retained worker volume.
Landlock, `no_new_privs` and OpenShell's network enforcement remain active.

The operator initializes the home before starting compute:

- `/home/node/.clawscarf-worker/host_ed25519`: unique server private key, mode 0600.
- `/home/node/.clawscarf-worker/authorized_keys`: Gateway's public client key, mode 0600.
- The parent directory is owned by UID/GID 1000, mode 0700.

Fresh initialization rejects a symbolic-link home and makes its empty volume
private before writing identity or keys. Resume verifies directory ownership, private credential-directory permissions and
a home that is not writable by other users before accepting the retained keys.
It reports changed permissions rather than silently repairing them.

Keep the corresponding client private key and verified server public key on the
Gateway side. Never put that client private key, the Gateway state directory or
controller identity in the worker. Generate keys for each installation, not in the
image. The team account can read its SSH server key; it is not a secret from that
team's execution. The image account has no usable password authentication.

[sshd_config](sshd_config) admits only public-key login as `node`; PAM, passwords,
SSH forwarding, user environment and user RC files are disabled. It starts as
UID 1000 and needs no root daemon. To choose a per-installation port, use the native
command with an explicit `-p`:

```sh
/usr/sbin/sshd -D -e -f /etc/ssh/clawscarf_sshd_config -p 2222
```

The operator's standard OpenShell forward exposes that same port on host loopback.
Only the Gateway receives an explicit outbound SSH policy for that endpoint. The
worker policy starts with no permitted outbound endpoints. Additional worker
network access must be declared explicitly; unrestricted Docker networking is not
an equivalent configuration.

## Native backend settings and persistence

Configure native `agents.defaults.sandbox` with `mode: "all"`, `backend: "ssh"`,
`scope: "agent"`, `workspaceAccess: "rw"`, and `ssh` settings containing the worker
target, `/home/node/sandboxes` as `workspaceRoot`, the private client key path and
pinned known-hosts file. Keep `strictHostKeyChecking: true`; a single operator-owned
server key does not require automatic `updateHostKeys`.

OpenClaw's role-required sessions retain their native behavior: workspace access
is capped to read-only agent input and execution roots are scoped by the session's
creator. These are logical namespaces on the shared worker account, not per-person
OS isolation. Preserve the native required-sandbox role policy.

The backend seeds each remote root once. Remote tool writes thereafter live on the
worker volume and are not synchronized back to the Gateway's agent workspace.
Native `sandbox recreate` removes that remote root before reseeding; it is a
state-destructive native action, not a worker repair or backup operation. Worker
stop/start and compute replacement must retain the worker home independently of
the Gateway home. Native sandboxed browser provisioning is not supported by this
backend; browser placement has a separate owner.

## Component acceptance

The opt-in [test](../../../tests/runtime/worker.test.ts) creates its own worker and
volume under an already-running isolated controller. It chooses an available SSH
port and generates private test keys. Set the controller's isolated XDG directories
as in the [controller guide](../../openshell/README.md#contributor-controller-setup),
then run:

```sh
export CLAWSCARF_TEST_SSH_WORKER=1
export CLAWSCARF_TEST_OPENSHELL=/absolute/path/to/openshell
export CLAWSCARF_TEST_GATEWAY=your-test-controller
export CLAWSCARF_TEST_WORKER_IMAGE="$(docker image inspect clawscarf-ssh-worker:local --format '{{.Id}}')"
export CLAWSCARF_TEST_DENIED_HOST_PORT=your-live-controller-port
pnpm exec tsx --test tests/runtime/worker.test.ts
```

The host port must actually accept connections from an ordinary Docker container;
that prerequisite prevents a false isolation pass. The confined worker must reject
it explicitly, not merely time out. Tests cover accepted/wrong client keys,
wrong-server-key rejection, UID/GID and supplementary groups, read-only system
files, absent privileged state/socket paths, denied egress and retained-home
stop/start. Cleanup removes only the test-owned resources. If allocation is
uncertain, the test reports its exact name and retains evidence for inspection.
The component test passed on macOS arm64/Docker Desktop with pinned OpenShell
0.0.116. It does not establish native member/browser/model acceptance or
clean-machine distribution support; those require the assembled installation.

## Sources and reuse

Uses OpenClaw's unchanged
[SSH backend contract](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/docs/gateway/sandboxing/ssh-backend.md)
and OpenShell's Docker driver. ClawScarf's runtime
[network build](../../images/network-tools/build.sh) and policy structure are reused;
no alternative firewall implementation or controller authentication is added.
The image includes the network-tool license notices. Its `network-sources` build
target exports corresponding sources and the exact build script, as for the
[main runtime image](../../images/README.md); distribute those artifacts together.
