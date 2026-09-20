# Optional packs

A ClawScarf pack groups native OpenClaw Claws. Each member is a normal
[CLAW.md](research-team/researcher/CLAW.md) package with an optional [OpenClaw profile](research-team/researcher/profiles/openclaw.yml). OpenClaw owns its agents,
workspace files, skills, plugins, MCP definitions, workflows and ownership records.
ClawScarf's small group manifest adds compatibility and prerequisite bindings; it
has no pack database or alternate installer for native resources.
Recipes can select pack IDs and members from the [CLI package](../release/README.md).
The CLI package carries the native files. Preparation records their content digests
and collects required operator/account inputs. No separate pack registry is involved.

The [research-team pack](research-team/pack.json) contains a researcher and reviewer
with workspace-only file tools. It requires the configured default model; it does
not install network tools, accounts or a provider. Its agents remain independent;
a person supplies material and transfers a draft for review.

## Select and change packs

Use `clawscarf configure --directory /path/to/team` to select bundled packs and
members. Noninteractive callers use `--pack <id:member,member>` and optional
`--pack-bindings <id=file>`. `--no-packs` removes all selected members. Changes
are reviewed before the server stops; native application finishes at startup.

The installation operator calls OpenClaw's native Claws preview/apply operations.
It preserves edited and unmanaged files, checks plan integrity and does not replay
uncertain mutations. Removing an agent remains destructive. Native monitor cleanup
uses OpenClaw's direct-local password authentication supplied by the
[runtime launcher](../runtime/README.md); trusted-proxy login remains in place for
people. Retained installations need the updated runtime image and a Gateway restart.

The private runtime helper only inspects packaged source. Individual portable Claws
can be built with native `openclaw claws build <member-directory> --out <artifact.tgz>`.

## Requirements and bindings

The manifest records model readiness, connection slots, binaries, execution location
and network requirements. `configured-default` checks native model configuration
and credential readiness, not a successful inference. It never sets a provider or
copies keys. Required binaries, network policy, native Claws commands, model readiness and
owned files are checked on the same protected team runtime.
The operator uses the official OpenShell SDK through its [transport](../scripts/packs/transport.py),
with the controller's existing TLS credentials. Supply its Python environment using
`--pack-python`; dependencies are pinned in [requirements.txt](../scripts/packs/requirements.txt).
Operations target the recorded runtime UUID, so replacing a sandbox under the same
name cannot redirect a mutation. Browser/controller credentials remain outside it.

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
agent and reconfigure the pack. An account restricted to a not-yet-created agent needs
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
uses vanilla OpenClaw with trusted-proxy auth and its local CLI password. It covers
both an ordinary pack member and one with an owned automation, including removal
after a Gateway restart, preservation of edited files and rejection of forwarded
password authentication. The copied fixture omits the model prerequisite; no model
inference is purchased. Set `CLAWSCARF_TEST_NATIVE_PACKS=1` to run it, optionally
with `CLAWSCARF_TEST_OPENCLAW` pointing at the packaged runtime launcher. The same
fixture has passed inside a disposable OpenShell runtime using the pinned upstream
image plus the updated launcher.
[Operator binding checks](../tests/packs/connections.test.ts) cover current session,
exact grants and revision drift. [Transport checks](../tests/packs/transport.test.ts)
cover UUID dispatch and uncertain failure without replay. The optional
[OpenShell binding test](../tests/packs/openshell.test.ts) uses controlled account HTTP
with real SDK/native package ownership on one runtime. It requires
`CLAWSCARF_TEST_PACK_SANDBOX`, the controller/SDK settings and an already-running
Gateway with native CLI authentication. Its token-authenticated fixture does not
qualify trusted-proxy removal, external OAuth or connector execution.
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
