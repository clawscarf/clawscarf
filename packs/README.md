# Optional packs

A ClawScarf pack groups native OpenClaw Claws. Each member is a normal
[CLAW.md](research-team/researcher/CLAW.md) package with an optional [OpenClaw profile](research-team/researcher/profiles/openclaw.yml). OpenClaw owns its agents,
workspace files, skills, plugins, MCP definitions, workflows and ownership records.
ClawScarf's small group manifest adds compatibility and prerequisite bindings; it
has no pack database or alternate installer for native resources.
Recipes can select pack IDs and members from a [release bundle](../release/README.md).
The bundle carries native files beside its JSON metadata; setup checks their digests
and collects required operator/account inputs. No separate pack registry is involved.

The [research-team pack](research-team/pack.json) contains a researcher and reviewer
with workspace-only file tools. It requires the configured default model; it does
not install network tools, accounts or a provider. Its agents remain independent;
a person supplies material and transfers a draft for review.

## Inspect and operate

The runtime image ships the pack tool and the included pack. No repository checkout,
package installation or second OpenClaw is required inside it. For an existing
OpenShell installation, use authenticated operator execution:

```sh
# Use the controller configuration selected during installation.
pack() {
  openshell sandbox exec --name clawscarf --gateway clawscarf \
    --env OPENCLAW_EXPERIMENTAL_CLAWS=1 -- /app/clawscarf/bin/packs "$@"
}
pack inspect /app/clawscarf/packs/research-team
pack add /app/clawscarf/packs/research-team \
  --member researcher --workspace /home/node/workspaces/researcher \
  --plan /home/node/researcher-plan.json
pack apply /home/node/researcher-plan.json --yes
pack status researcher
```

Replace sandbox/gateway names with the selected deployment. The launcher selects
the existing native state and CLI. Configure its [model gateway](../deploy/models/README.md)
first; the pack does not install or request provider credentials. Native Claws are
experimental: the explicit environment flag opts into that upstream capability.
Keep the Gateway running for native removal, including monitor cleanup. Plans and
workspaces are written to the persistent home volume, never the image.

For development with a local OpenClaw **2026.9.4** installation, invoke
`pnpm clawscarf packs` in place of `pack`, using the normal native
`OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`. That source command is not required
inside the packaged runtime.

Review the entire plan before `apply`. Repeat the preview/apply pair for `reviewer`.
Each member has its own native plan because installing one agent changes the next
agent's observed configuration. There is no misleading atomic multi-agent promise.
Use `update` or `remove` in place of `add` for explicit reapplication or removal.
Plans include native capability changes and integrity, selected prerequisites and
pack source digest. Apply rechecks them and rejects drift. No force-removal options
or automatic mutation retries are exposed. Native removal preserves edited and
unmanaged workspace files; removal of an agent is still a destructive action.

Use the native `openclaw claws build <member-directory> --out <artifact.tgz>`
command to build individual portable packages. No ClawScarf-specific agent format
is required by a consumer of those packages.

## Requirements and bindings

The manifest records model readiness, connection slots, binaries, execution location
and network requirements. `configured-default` checks native model configuration
and credential readiness, not a successful inference. It never sets a provider or
copies keys. Required binaries, network policy, native Claws commands, model readiness and
owned files are checked on the same protected team runtime.
Local runtime pack commands cannot qualify execution requirements; use the operator
with the protected runtime target for those packs.

For connection-dependent packs, operate from the controller machine. Install the
released official OpenShell Python SDK using the [hashed dependency lock](../scripts/packs/requirements.txt):

```sh
uv venv --python 3.12 .local/pack-operator
uv pip sync --python .local/pack-operator/bin/python scripts/packs/requirements.txt
export OPENCLAW_EXPERIMENTAL_CLAWS=1
pnpm clawscarf packs --sandbox clawscarf --gateway clawscarf \
  --python .local/pack-operator/bin/python \
  add /path/to/pack --member assistant --workspace /home/node/workspaces/assistant \
  --bindings /private/bindings.json --plan /private/assistant-plan.json
pnpm clawscarf packs --sandbox clawscarf --gateway clawscarf \
  --python .local/pack-operator/bin/python \
  apply /private/assistant-plan.json --bindings /private/bindings.json --yes
```

Use `--openshell` for a non-default CLI path. The [operator bridge](../scripts/packs/transport.py)
uses official OpenShell **0.0.116** `SandboxClient` with the controller's existing
TLS/OIDC configuration. It records the runtime UUID in the preview and
dispatches every operation to that target. Reusing a deleted sandbox's name cannot redirect a mutation. No controller or browser
credentials are copied to the runtime. The built operator artifact preserves this
helper beside its compiled CLI; Python and its SDK environment stay on the operator
machine. The runtime command deliberately omits remote and browser-binding options.

A binding file contains:

```json
{
  "origin": "https://team.example.com",
  "brokerUrl": "https://team.example.com/_clawscarf/connections",
  "sessionFile": "/private/current-session",
  "connections": { "documents": "00000000-0000-4000-8000-000000000001" }
}
```

Keep both files outside the pack. The generated REST client verifies the exact
account ID/type, current account state and grant for the target agent using the
administrator's current session. Missing selected-agent grants block preview;
never widen access automatically. Initial installation can use an existing account
already available to all agents. Once the pack exists, restrict that account to its
agent and use update/apply. An account restricted to a not-yet-created agent needs
an explicit two-stage setup; this command does not invent pre-admission grants. The target plugin's configured broker must match the explicit `brokerUrl`. `origin`
is the administrator-facing management origin; these may differ in a local
composition (for example, localhost versus a private runtime hostname). This is
operator-owned deployment mapping, not discovery or cryptographic server identity.
All selected accounts must belong to the same server and their server IDs are
recorded in the reviewed plan. Public URL
matching does not prove runtime-credential validity: the broker still checks that
credential and current grants on each tool call.

A connection-dependent member declares `connectionFile`, for example accounts.json.
Its native [CLAW.md](research-team/researcher/CLAW.md) must explicitly include that file in `workspace.files`; the
pack's instructions must tell its agent to read it. ClawScarf renders only that
JSON file with schema version 1 and a `connections` array of slot, connectionId,
name and connectorId. It performs no prompt templating and copies no credential.
Native Claws previews and owns the file, including update/removal and preservation
of user edits. An account slot is therefore concrete agent-readable configuration,
not merely a successful prerequisite check.

Preview uploads a fresh private source directory; it does not overwrite earlier
staging directories or agent workspaces. Apply rechecks local/target digests, native
plan integrity, account revisions/grants and policy before mutation. A changed
account or source needs a new preview. No mutation is replayed automatically after
an uncertain result. Staged source directories remain available for native ownership
records and reviewed plans; deleting them invalidates those plans.

Network requirements are explicit objects with `binary` (canonical absolute target
path), `host` (exact DNS name), `port` and `protocol: "tcp"`. The operator checks the
runtime sandbox's effective policy against its acknowledged loaded revision, records exact
hash/version/config revision and rechecks for changes. Only unconditional exact
executable/TCP grants are supported. Global/provider-composed mismatches, wildcard,
audit and conditional/L7 policies fail closed. Omitted native protocol means proxy
passthrough, not transparent TCP, and does not satisfy a TCP requirement. This checks
loaded policy coverage, not DNS/reachability, successful account operations or
per-agent isolation when agents share an executable. It never changes policy.

## Verification

[Lifecycle checks](../tests/packs/lifecycle.test.ts) cover source changes, model
readiness changes and source-link rejection. The [native test](../tests/packs/native.test.ts)
uses the pinned vanilla OpenClaw CLI and Gateway for both agents. It deliberately
uses a copied fixture without the model prerequisite to qualify ownership and file
preservation independently of live inference. The packaged tool also completed inspect, add/apply, status, update/apply and
remove/apply for both unmodified research-pack members inside a disposable pinned
OpenShell runtime with the configured-model prerequisite enabled; edited identities
and unrelated files survived removal. This qualifies native lifecycle and model
configuration readiness, not agent research quality. [Operator binding checks](../tests/packs/connections.test.ts) cover current session,
exact grants and revision drift. [Transport checks](../tests/packs/transport.test.ts)
cover UUID dispatch and uncertain failure without replay. The optional
[OpenShell binding test](../tests/packs/openshell.test.ts) uses controlled account HTTP
with real SDK/native package ownership; this is not external OAuth/tool qualification.
[Policy checks](../tests/packs/policy.test.ts) cover loaded acknowledgment and drift.
[Execution-target checks](../tests/packs/execution-target.test.ts) use controlled operator
processes to verify unified runtime dispatch, missing binaries, denied policy
and runtime replacement. They do not replace live OpenShell qualification.
A disposable runtime with the image's nftables 1.1.3/libnftnl 1.2.9 dependencies
loaded an explicit TCP policy: verification accepted its exact process/host/port
and rejected a different port. This qualifies policy observation and matching;
it does not establish a successful connector request or application execution.

Run `CLAWSCARF_TEST_NATIVE_PACKS=1 pnpm exec tsx --test tests/packs/native.test.ts`
for the disposable native test. It writes isolated temporary state and uses the
pinned OpenClaw dependency installed for the Connections plugin.
