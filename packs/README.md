# Optional packs

A ClawScarf pack groups native OpenClaw Claws. Each member is a normal
[CLAW.md](research-team/researcher/CLAW.md) package with an optional [OpenClaw profile](research-team/researcher/profiles/openclaw.yml). OpenClaw owns its agents,
workspace files, skills, plugins, MCP definitions, workflows and ownership records.
ClawScarf's small group manifest adds compatibility and prerequisite bindings; it
has no pack database or alternate installer for native resources.

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
`pnpm exec tsx scripts/packs.ts` in place of `pack`, using the normal native
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

The manifest records model readiness, required connection slots, binaries, execution
location and network requirements. `configured-default` checks the actual native
`models status --json --check` result; it is credential/configuration readiness,
not proof of a successful paid inference. It never sets a provider or copies keys.
Required binaries are checked in the command's execution environment. Packs requiring
extra network policy fail closed until a concrete runtime-policy verifier is bound;
this command cannot claim that a declared endpoint is permitted by OpenShell.

Connection-dependent packs are **not yet supported by the packaged runtime**.
Do not copy a browser administrator session into that runtime. Operator-side account
verification plus authenticated target execution remains unfinished. The local
source command can verify connection slots by ID using a private JSON file on the
operator machine:

```json
{
  "origin": "https://team.example.com",
  "sessionFile": "/private/current-session",
  "connections": { "documents": "00000000-0000-4000-8000-000000000001" }
}
```

Pass `--bindings <file>` during preview and apply. The generated REST client checks
the exact current account, connector type and agent grant as the signed-in native
administrator. The pack contains no provider tokens. Native package requirements
must still declare any plugin/skill dependencies they need; account bindings do not
install an extension. The included research pack needs no connection bindings.

## Verification

[Lifecycle checks](../tests/packs/lifecycle.test.ts) cover source changes, model
readiness changes and source-link rejection. The [native test](../tests/packs/native.test.ts)
uses the pinned vanilla OpenClaw CLI and Gateway for both agents. It deliberately
uses a copied fixture without the model prerequisite to qualify ownership and file
preservation independently of live inference. The packaged tool also completed inspect, add/apply, status, update/apply and
remove/apply for both unmodified research-pack members inside a disposable pinned
OpenShell runtime with the configured-model prerequisite enabled; edited identities
and unrelated files survived removal. This qualifies native lifecycle and model
configuration readiness, not agent research quality. Connection-dependent packs and
network-policy verification remain unfinished.

Run `CLAWSCARF_TEST_NATIVE_PACKS=1 pnpm exec tsx --test tests/packs/native.test.ts`
for the disposable native test. It writes isolated temporary state and uses the
pinned OpenClaw dependency installed for the Connections plugin.
