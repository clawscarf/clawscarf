# Installation interface — proposed v1

This is a design for the next configuration/CLI slice, not an implemented schema or
runnable command reference. [Local setup](../deploy/local/README.md) owns today's
commands. [TODO.md](../TODO.md) owns selection and unfinished work. The installer,
People changes and external hosting adoption require their own implementation slices.

## One installation, three callers

One validated installation document describes one trusted team server. The CLI
composes existing operators. A person can author the document, an installer can
collect choices and generate it, or a hosting platform can generate it unattended.
All use the same validation, preview and application implementation.

The document selects artifacts, persistent storage, exposure, access, execution,
models, Connections and optional packs. It does not mirror conversations, native
roles, people, every agent setting or every OpenClaw configuration key. OpenClaw
remains mutable and authoritative for its application state.

## Concrete standalone example

**Proposed syntax; illustrative paths and endpoints, not accepted by today's CLI.**
This example selects local operator login, OpenShell execution and an existing
model gateway. Browser, Connections and packs are optional and initially omitted.
A fully offline/model-free setup changes `models` to `{ "mode": "disabled" }`.

```json
{
  "schemaVersion": 1,
  "name": "team",
  "artifacts": { "manifestFile": "./artifacts.lock.json" },
  "stateDirectory": "./state",
  "storage": { "mode": "docker-volumes" },
  "exposure": {
    "mode": "local",
    "applicationPort": 18800,
    "widgetPort": 18802
  },
  "access": {
    "mode": "local",
    "administratorName": "Miguel"
  },
  "execution": {
    "mode": "openshell",
    "gateway": { "cpu": "2", "memory": "2Gi" },
    "worker": { "cpu": "2", "memory": "2Gi" },
    "browser": { "enabled": false }
  },
  "models": {
    "mode": "external",
    "configurationFile": "./models.json",
    "credentialFile": "./secrets/model-runtime-key"
  },
  "connections": { "mode": "disabled" },
  "packs": []
}
```

The referenced model file reuses the current [model configuration](../scripts/models/configuration.ts):
`mode: external`, an HTTPS `/v1` endpoint, a default model and enabled model descriptors.
These are model IDs actually served by that endpoint, not guessed provider names.
The runtime key authorizes this installation at that gateway; it is not the upstream
OpenRouter/OpenAI key. Optional `caFile` permits an explicitly trusted private CA.

Relative paths resolve against the document, not the working directory. Validation
resolves and checks private secret files without printing contents. Deployment may
materialize private copies/mounts; an upstream file change does not silently rotate a
running credential. Rotation is an explicit operation.

The generated artifact lock selects exact image digests and pinned controller tools
with platform/checksum information. The existing [component manifest](../release/components.json) only pins
components; it is not already this complete artifact lock. Development builds and
published releases produce the same lock shape. No silent build/download fallback,
mutable `latest` tags or hand-entering ten image IDs in the interactive installer.
The operator validates host support and includes prerequisite failures in preview.

Public application/widget ports are explicit. Internal ports and network addresses
are allocated and retained by the operator, with collision checks; an optional
advanced override can use today's validated port structure. No raw Gateway,
controller, database, model administration or browser-control port becomes public.
The resource values above are configuration examples, not release sizing guarantees.

## Standalone company variant

Use the same complete document, replacing its exposure/access selections with the
following. This excerpt is not an overlay mechanism. The IdP application and DNS/TLS
are supplied by the operator; the installer can explain callback URLs but cannot
create an arbitrary company's IdP configuration itself.

```json
{
  "exposure": {
    "mode": "https",
    "applicationOrigin": "https://team.example.com",
    "widgetOrigin": "https://widgets.team.example.com",
    "certificateFile": "./secrets/server-chain.pem",
    "keyFile": "./secrets/server-key.pem"
  },
  "access": {
    "mode": "oidc",
    "administratorName": "Miguel",
    "issuer": "https://identity.example.com",
    "clientId": "clawscarf-team",
    "clientSecretFile": "./secrets/oidc-client-secret",
    "bootstrap": { "mode": "owner-claim" }
  }
}
```

The owner-claim flow below is proposed. Today's OIDC operator instead requires an
explicit administrator subject and email. Hosting behind an existing reverse proxy
uses an explicit supported transport binding; it must not infer trust from headers.

## Other supported selections

| Area        | Proposed v1 selections                                                                                               | Existing basis / missing work                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposure    | Local loopback; HTTPS with application/widget origins and certificate/key file references; external platform ingress | Local and HTTPS team profiles exist. External ingress needs a qualified consumer binding. Automatic public DNS/ACME provisioning is not implied.                                          |
| Access      | Local operator login; generic OIDC; external platform identity/entry                                                 | Local/OIDC work today. A company IdP is not an admission list. External mode must not start a second login authority or People database.                                                  |
| Execution   | OpenShell Gateway plus shared protected worker; optional native browser node                                         | Current operators implement these components. Browser target-selection bug remains owner-managed. No new VM provider or alternative sandbox backend in v1.                                |
| Models      | Disabled; existing gateway; local LiteLLM                                                                            | Config/render/apply and gateway components exist. Unified lifecycle for local LiteLLM, secret delivery and rotation still needs wiring.                                                   |
| Connections | Disabled; existing broker; local service with Composio                                                               | Existing modules/plugin/catalog and activation path. Unified lifecycle and real external-account acceptance remain. Local mode uses the existing companion, not a new service extraction. |
| Packs       | Explicit versioned selections plus member/prerequisite bindings                                                      | Native Claws group manifest and preview/apply exist. Group selection must compose them, not invent another agent installer.                                                               |
| Storage     | Owned Docker volumes; host-supplied directory tree                                                                   | Docker volumes exist. Directory-backed state needs mount/UID/ownership support before hosted use. ZFS is not required by ClawScarf.                                                       |

For `models.mode: litellm`, reference the current route configuration and a private
upstream-key environment file. Compose the pinned LiteLLM service, private transport,
scoped runtime key and native model configuration together. Never give its master or
upstream credentials to OpenClaw. No credits or billing implementation in this slice.

For `connections.mode: local`, retain today's `projectId`, `apiKeyFile` and
`catalogDirectory`. For external mode, use `brokerUrl`, a scoped `credentialFile`
and optional `caFile`. A shared Composio project key stays in the broker. Connections
setup and account OAuth remain separate: installation can prepare the plugin without
connecting a human's Gmail/Outlook account or pretending that an account exists.

A browser selection starts the existing browser/node/DNS/ingress components from the
artifact lock. It must disclose the documented upstream limitation; the wizard must
not advertise ordinary browsing as qualified. Bundled capability selection should
initially enumerate only reviewed capabilities and their prerequisites. Do not equate
an image containing Lobster/Codex/Chromium with every associated feature being enabled
or qualified. Current bundled defaults need mapping to explicit selections before the
installer offers switches; arbitrary native plugins and vanilla ClawHub remain native.

## Change semantics and CLI

Proposed commands, implemented by evolving the existing modules:

```text
clawscarf validate --config installation.json
clawscarf plan --config installation.json --json
clawscarf apply --config installation.json --plan <plan-file> --yes
clawscarf start --state ./state
clawscarf stop --state ./state
clawscarf status --state ./state --json
clawscarf logs --state ./state --service gateway
clawscarf doctor --state ./state --json
clawscarf login --state ./state
```

`apply` prepares/reconfigures owned resources; `start` supervises the prepared stack
in the foreground, as today's operator does. A hosting platform runs that foreground
process under its service manager. The installer uses the same commands and later
chooses how to present foreground/background operation; no second orchestrator.
Keep the existing explicit upgrade operation and fold its flags into this interface.

A preview identifies installation, input/observed revisions, affected resources,
restart requirements and secret references. It contains no secret material and grants
no authority by itself. Application checks ownership and observations again; stale
previews fail for a new preview rather than overwriting later edits. Hosted callers
supply an operation ID; retain receipts and uncertain outcomes across interrupted SSH
or CLI sessions. Return bounded structured errors/status, with human progress on stderr.
A successful preparation is not proof that login or a model response has succeeded.

| Change                                         | Application behavior                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First installation                             | Initialize only fresh owned state; configure selected components and intended administrator; report individual readiness results.                                                                                  |
| Ordinary start/status/refresh                  | Observe/start retained state; never reapply native defaults or silently enroll a revoked identity.                                                                                                                 |
| Model catalogue/default or broker endpoint/key | Preview precisely the selected native settings and secret replacement; preserve other providers, agent overrides and unrelated native edits. Reapply requires explicit selection even if the file has not changed. |
| Enable/disable integration                     | Show plugin/service and network-policy changes, restarts and effect on existing agents. Disable retains data and revokes access deliberately; it is not deletion.                                                  |
| Pack add/update/remove                         | Use native preview/lifecycle per member, observed ownership and prerequisites. Show partial completion; never replay uncertain agent creation. Removal/data consequences need confirmation.                        |
| Resources, exposure or runtime image           | Use reviewed stop/replacement/upgrade paths. Reject unsupported changes before mutation; no implied live migration.                                                                                                |
| Identity issuer, storage root or ownership     | Immutable in initial v1. Explicit migration is separate; changing a JSON string must not transfer existing users/data.                                                                                             |

An installation is identified by persisted ownership, not its display name or JSON
filename. Deleting the document never deletes volumes. There is no continuously
running desired-state reconciler that undoes native administration.

## Login and People: recommendation to decide before implementation

There are two different jobs:

1. **First administrator:** belongs to installation/bootstrap. Local mode already
   issues a private one-use code. For standalone OIDC, extend that explicit owner
   proof: issue a short-lived one-use claim, authenticate through the configured IdP,
   bind the resulting `(issuer, subject)` to the prepared initial administrator, then
   verify native administrator authority. The person does not look up a subject ID.
   Possessing the owner claim is deliberately administrator authority; protect and
   consume it atomically, and permit explicit regeneration only before claim completion.
   Never make the first arbitrary website visitor or every IdP user an administrator.
2. **Ongoing people:** belongs to People, not the installation document. A small v1
   can let an OIDC-authenticated person request admission, showing their actual identity
   to an administrator for approval. Pending users receive no native session/access.
   Existing native enrollment/removal handles approval and revocation; OpenClaw owns
   role editing. No SMTP, directory sync or invitation platform is necessary for this.

These are proposed UX choices, not already implemented promises. An explicit known
issuer/subject bootstrap remains useful for unattended automation. If request/approve
is undesirable, an administrator-created single-use invite link is an alternative;
choose one first rather than implementing both. Standalone local evaluation can remain
one administrator. External hosting uses its existing enrollment UX instead of either
standalone flow. This design resolves the subject-ID problem without duplicating roles.

## RawClaw integration: concrete consumer plan

The shared schema calls this `external` mode; there is no vendor-named mode, hosting
SDK dependency or organization database inside ClawScarf. RawClaw remains a consumer.

Current source evidence: RawClaw's [native initialization port](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/installations/types/openclaw/bootstrap.ts),
[SSH implementation](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/installations/providers/ssh/openclaw/bootstrap.ts)
and [runtime/storage layout](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/deploy/README.md).
ClawScarf's [current hosting boundary](../runtime/README.md#external-hosting-boundary)
already describes the intended ownership, but today's local operator does not implement
an external-access profile. This is a consumer integration, not just an image substitution.

| Owner     | Responsibilities                                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RawClaw   | Organizations, user admission, acting-user authorization, billing, VM/data-volume allocation, edge routing/DNS/TLS, user sessions and live stream revocation, shared LiteLLM and Connections broker, operation intent and credentials. |
| ClawScarf | Exact runtime/worker/browser artifacts, supported native presets and plugins, local execution lifecycle/protection, persistent mount contract, explicit setup/change/status commands and diagnostics.                                  |
| OpenClaw  | Native agents/roles/profiles, conversations, tools and mutable application configuration.                                                                                                                                              |

The hosted configuration uses the same core document with these selections:

```json
{
  "storage": {
    "mode": "directory",
    "root": "/var/lib/rawclaw/data/clawscarf"
  },
  "exposure": {
    "mode": "external",
    "applicationOrigin": "https://app-<installation>.rawclaw.raw-labs.com",
    "widgetOrigin": "https://widgets-<installation>.rawclaw.raw-labs.com",
    "ingressBindingFile": "./private/ingress-binding.json"
  },
  "access": {
    "mode": "external",
    "administratorIdentity": "<exact identity asserted by the platform>"
  },
  "models": {
    "mode": "external",
    "configurationFile": "./private/models.json",
    "credentialFile": "./private/model-runtime-key"
  },
  "connections": {
    "mode": "external",
    "brokerUrl": "https://<platform-broker-endpoint>",
    "credentialFile": "./private/connector-runtime-key"
  }
}
```

This is a selection excerpt, not an overlay format or runnable file. The consumer
supplies a complete resolved document. Hostnames are illustrative; RawClaw's existing
endpoint allocator supplies the actual application/widget origins.

`ingressBindingFile` must describe a concrete authenticated transport, allowed caller
certificates, exact native identity/forwarding-header mapping, application/widget routes
and management entry. A URL or arbitrary trusted header alone is insufficient. Map the
existing private mTLS relay into this contract; verify spoofed-header denial, correct
names, native roles, current admission, logout and already-open stream revocation.
Separate generic OIDC is not configured per installation: RawClaw's existing shared
WorkOS integration authenticates users and its portal/edge routes them.

External access starts no ClawScarf login/People service and hides its standalone
navigation. With external models and Connections, it starts no local LiteLLM, broker
or Access database either. The runtime still has its necessary machine/control
transport. Today Connections shares the standalone Access companion; omitting both
is straightforward conceptually but still requires implementing/qualifying this profile.
Current plugin/broker contracts must be compared explicitly; extraction provenance
does not guarantee current wire compatibility. RawClaw's membership, generation and
agent-grant checks remain authoritative at the broker.

There are concrete naming/version differences to resolve as well: RawClaw's inspected
runtime pins OpenClaw 2026.9.2, uses model references under `rawclaw/` and the
`rawclaw-connectors` plugin; ClawScarf pins 2026.9.4 and uses its own model/plugin IDs.
RawClaw's observation, AI apply and connector setup adapters must consume the selected
artifact's native identifiers and supported operations. Merely replacing the VM
image would leave those calls targeting the wrong settings. Do not add vendor aliases
inside ClawScarf to hide this mismatch.

Adoption sequence, inside a separately selected RawClaw slice:

- Build/qualify Linux amd64 ClawScarf artifacts and its directory-backed storage on a
  disposable host. RawClaw currently runs systemd OpenClaw/rootless Docker; ClawScarf
  changes that execution topology to an external OpenShell controller and worker.
- Keep RawClaw's host provider/allocation and operation fencing. Add an adapter behind
  its native initialization boundary to write private configuration and call the
  ClawScarf CLI over existing authenticated SSH. Read structured status/endpoints;
  the worker waits for milestones instead of holding a browser request open.
- Map the supplied data volume to separate Gateway home, worker home, browser profile
  and node identity directories with correct UID ownership. ClawScarf uses UID 1000;
  RawClaw's existing native service uses UID 2000. Keep controller/ingress secrets and
  authority outside agent-writable mounts. No anonymous/Docker-root-disk state that
  disappears when compute is replaced. Preserve revocation independently of restored
  runtime state; volume attachment alone does not qualify recovery.
- Supply existing platform ingress, scoped model and connector credentials. Preserve
  source-bound inference checks against the actual hosted VM transport, acting-user
  native management, generation revocation and agent grants. Do not duplicate WorkOS
  projects or install shared OpenRouter/Composio keys in customer runtimes.
- Prove a fresh hosted installation end to end, including admin/member login, model
  and connector calls, revocation and stop/start. Keep existing installations on their
  bound artifact; converting retained UID/layout/native state is a separate migration.

VM deletion and data-volume retention/deletion stay RawClaw responsibilities.
ClawScarf's stop command never destroys a customer machine or claims an off-host backup.

## Recipes, packs and the eventual installer

Keep three starter recipes as ordinary complete configuration examples: local
operator evaluation, standalone OIDC team, and externally managed hosting. They may
select packs, but have no inheritance, template expressions, arbitrary shell hooks,
recipe registry or separate application lifecycle. The installer copies/generates
one complete document; later edits apply to that document, not a changing recipe.

Packs are application content: a pack can contain several native Claws/agents and
require models, capabilities or a particular connected-account type. The included
`research-team` has two members and needs a configured model, but no connector.
A proposed explicit selection is
`{ "id": "research-team", "version": "0.1.0", "members": ["researcher", "reviewer"] }`
in `packs`; these members are native agent packages, not people. Resolve the exact
pack from the artifact lock and preview agent IDs/workspace locations and collisions.
Installation previews prerequisites first. If an external account must be connected
interactively, leave that pack visibly pending for explicit continuation; do not
invent OAuth credentials, grant every agent access, or roll back the whole server.
Only actual selected dependencies are requirements. A general pack marketplace is
outside v1; existing native Claws remain experimental at the pinned release.

The future terminal installer selects a recipe and artifact source, asks the relevant
access/exposure/integration questions, writes private secrets and configuration,
shows the same CLI preview, applies and starts. It reports the working URL and the
remaining human steps. An existing installation opens a reconfiguration flow rather
than overwriting its state. The same complete document supports unattended deployment.
Installer visual style and precise opt-in choices remain a later discussion.

## Implementation boundaries

Build the schema/preview/CLI around the existing local path first; add coherent
external transport/storage contracts so a consumer does not need a competing design.
Do not claim RawClaw adoption until its adapter and one Linux hosted installation
pass. Choose the standalone first-admin and People admission flow before changing
Access. Wire selected optional integrations next, qualify a release, then build the
installer. The owner-managed upstream browser issue stays outside this work.
