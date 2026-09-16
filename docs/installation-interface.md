# Installation and management design

This is the working design for installing a ClawScarf team server and managing it
later through the same CLI. It records the agreed direction, the remaining decisions
and the implementation order. It is not a claim that the complete journey exists.
The [CLI guide](../deploy/local/installation.md) documents what runs today;
[TODO.md](../TODO.md) remains the only task checklist. This design does not authorize
implementation of every section.

## Product boundary

One installation serves one trusted team. Vanilla OpenClaw owns agents, roles,
conversations and mutable application settings. ClawScarf supplies protected entry,
initial configuration and explicit management operations; it does not replace the
native dashboard or continuously undo changes made there.

The fixed foundation is OpenShell protection around the Gateway, a separate protected
shared execution worker, authenticated entry, admission and session revocation.
Recipes cannot disable these protections. Execution files and browser accounts are
shared within the team; native users and roles remain distinct. Native plugins can
execute in the Gateway, so this is not a claim that every tool runs on the worker.
Controller credentials remain outside both.

Managed inference uses LiteLLM, either supplied with the installation or externally
operated. This is a technical requirement, not a question in the normal model setup.
Connections and packs are optional. Disabled Connections requires no provider keys,
account setup, active Connections service or unusable tools. No selected capability
may fall back to weaker execution or authentication when prerequisites are missing.

## The installation experience

### 1. Choose a recipe, then review its settings

A recipe supplies visible, editable defaults. Choosing one opens the same configuration
menu used for Custom; it does not immediately ask for a secret or force the user
through every section. The first item is selected and visually separated:

```text
ClawScarf — Team documents

  Accept settings and continue
  ──────────────────────────────────────────────
  Name             My team
  Login            Local evaluation
  Models           GPT-6 Astra · Medium · OpenRouter
  Connections      Off
  Packs            None
  Resources        Recommended
  Advanced         Location, networking and gateway settings

Esc: back · Ctrl+C: exit
```

This is a layout sketch. Team documents remains an illustrative recipe, without a
document workflow. Its chosen model default is GPT-6 Astra / medium via OpenRouter;
that route still needs a real provider test. Local evaluation is loopback-only and
single-administrator. Sharing a team server requires the company-login configuration.

The menu shows missing required settings beside the relevant section. Accepting it
collects those missing inputs next; it does not declare an incomplete configuration
ready. CLI-supplied answers populate the same menu and skip already answered prompts.
Advanced options do not clutter the normal flow, but remain inspectable and available
to automation. Unsupported or experimental capabilities must say so before selection.

### 2. Choose models before entering their credentials

Models shows the default model, reasoning level and provider. A recipe may preselect
OpenRouter, but the choice must be visible and editable among supported routes.
Reasoning choices come from the selected model's supported options. The model catalog
can enable several models and route them through different providers.

Only after accepting the settings does setup ask for missing credentials, with context:

```text
LLM credentials

Model       GPT-6 Astra
Reasoning   Medium
Provider    OpenRouter

OpenRouter API key: ********
```

Ask once per required provider credential, not once per model. Use masked input or
private-file import; never use an environment variable name as the user-facing label.
Changing the provider updates the required inputs. A stale key for a previous choice
must not be silently reused for a different provider. Existing credentials are shown
as configured, never revealed. Normal copy names the model and provider, without
explaining the internal gateway.

The release needs supported provider/model metadata and credential requirements.
The current route format can describe LiteLLM routes, but that alone does not establish
a working installer experience for every provider LiteLLM supports. The initial
selectable provider list is still to be chosen and tested. Existing model gateways,
custom endpoints, catalogs and private CAs belong under Advanced and in configuration.
Upstream provider keys stay outside OpenClaw; its runtime credential is scoped to the
installation's model gateway.

### 3. Collect the remaining inputs and install

Collect only what the selected configuration needs: provider keys, OIDC configuration,
URLs/TLS, and Connections backend credentials when enabled. Name and resource settings
are ordinary configuration; the first administrator's identity is established during
sign-in below. Do not ask normal users to find their OIDC subject ID.

For company login, show the required callback URLs before asking the operator to
finish the IdP setup. Use generic OIDC, not a WorkOS-specific installation path.
Public DNS, a registered IdP client and suitable TLS are real prerequisites; the
installer must explain missing inputs instead of implying it can create them for
any company automatically.

Present one final review and an **Install** action. Validate the release, host and
selected dependencies before allocating resources. Show progress for the actual
work, with a useful failure and retry path. Save/preview/prepare remain CLI operations;
the normal menu should not require users to understand three competing ways to start.

The server must become reachable before browser setup begins and remain running when
the setup UI exits. Reuse the existing lifecycle owner and supervision; the terminal
must not become a second deployment engine. The current launcher runs in the foreground,
so persistent supervision and returning control to the menu need an explicit implementation
choice before this stage is built.

### 4. Establish the first administrator in the browser

For OIDC, the terminal displays a private, expiring, single-use setup link and offers
to open it. Its holder signs in through the configured provider. The server atomically
binds that identity as the initial administrator, verifies native authority, and the
terminal observes completion. A successful provider login alone never admits someone.
The first arbitrary visitor must not become administrator.

An unused expired link can be explicitly replaced. Once claimed, reopening setup
cannot claim ownership again or restore a revoked administrator. Retain explicit
issuer/subject bootstrap for unattended configuration. Local evaluation keeps its
existing one-use operator login instead of inventing a company identity requirement.

### 5. Set up selected connections from the terminal

There are two operations, both available during installation:

- **Enable Connections:** configure its backend and credentials, then prepare the
  service/plugin. The normal flow uses a packaged connector catalog, not a request
  for a prepared catalog directory. Credentials and project-specific auth configuration
  do not belong in a shared release. An external broker remains an advanced option.
- **Link accounts:** select a connector, obtain its setup URL, open it in the browser,
  complete provider consent, and return to terminal progress. Show the verified account
  and its intended agent grants, then offer to add another account or continue.

Reuse the current backend's setup, continuation, cancellation, reconnection and
revocation operations. The existing server receives authentication callbacks; an
extra localhost callback server in the CLI is not assumed necessary. Its actual HTTPS
and provider callback requirements must be met. Company sign-in and external account
consent can still require browser pages; ordinary management need not force the user
to navigate a separate website. Existing People/Connections pages remain another
client of the same operations, not a competing source of state.

If a selected pack requires a particular account, setup remains incomplete until
that dependency is satisfied. Otherwise account linking may be skipped and reopened
later. Enabled does not mean an account is connected. Failed backend setup, expired
consent and unknown outcomes must remain distinguishable; do not automatically start
another allocation or claim success from a redirect alone.

### 6. Finish with a usable result

Verify the selected configuration: protected login, effective administrator access,
model inference and any selected capability's required setup. Starting containers is
not the completion condition. Display the application URL and concrete remaining
actions if setup is interrupted or a required step fails. Optional ideas and unselected
capabilities are not completion gates.

## Navigation and reopening the CLI

- Esc returns to the parent screen; at the first screen it exits. Ctrl+C exits.
  No Back rows. These rules apply to selectors, text and secret entry alike.
- A section is edited as a unit. Save accepts its answers into the setup draft;
  Esc discards that section's unaccepted changes and newly entered secrets.
  Previously accepted sections remain filled in. This is navigation state, not a
  custom deployment history or automatic application to a running server.
- Installation effects happen only after the final action. Exiting after an effect
  has started does not erase data or undo it. Show what completed and how to resume
  without replaying uncertain mutations.
- Reopening an existing installation offers current settings, Models, Connections,
  People, Packs and lifecycle actions. It does not run fresh provisioning or first-admin
  setup again. Actions belong next to the affected data; show progress there, retain
  known data during refresh, and distinguish unavailable from empty.

Ongoing account management includes list, link, reconnect, remove and agent-grant
changes. Removing access must take effect locally even if external cleanup fails.
The exact command names and interactive entrypoint should extend the existing CLI,
not introduce a second installer or management program.

Ongoing People enrollment still needs a choice: invite links or admission requests.
Both can be initiated or handled from the terminal with browser sign-in where needed.
Implement one first. OpenClaw remains the role authority; the installation document
does not become a people/role database.

## One implementation for people and automation

Menus collect and present; shared CLI operations validate configuration and perform
effects. Reuse the existing installation, model, pack, Access and Connections modules.
No generic workflow engine, recipe scripting system or duplicate transport layer is
needed. REST additions belong in the owning OpenAPI contract and generated client.

Every menu action needs a noninteractive counterpart: configure, preview/apply,
start/stop/status/logs, administrator setup, model changes, connection account management
and people operations. Machine-readable results distinguish success, pending action,
confirmed failure and unknown outcome. Human progress belongs on stderr.

Noninteractive does not mean bypassing OAuth consent. Commands return a private
continuation URL and an operation identifier when human authentication is required;
a later command can observe completion. Already supplied credentials/settings skip
prompts. Unknown outcomes are observed rather than blindly retried.

Add a supported CLI authentication flow for account/People management. It must bind
a session to the signed-in user, protect its credentials locally, and retain current
native authorization and revocation checks. Copying a browser cookie into a file is
not the intended operator experience. Root access to the installation's files must
not silently impersonate an arbitrary person at the Connections API.

## Configuration, releases and state

| Item                  | Purpose                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release               | Exact software version: pinned image digests, controller tools/checksums, platform support, recipes and their packaged content. No customer credentials or deployment state. |
| Recipe                | Defaults and selected dependencies belonging to that release. Copied once, then editable; no live inheritance, scripts or independent recipe registry.                       |
| Installation document | This server's complete settings and private-file references. Shared by interactive setup and unattended CLI use.                                                             |
| State directory       | Private identity, ownership and runtime/lifecycle state retained across stop/start. Separate from downloaded software; retained state is not a backup.                       |

The existing [installation schema](../scripts/installation/configuration.ts),
[recipe schema](../scripts/installation/recipes/definition.ts),
[release schema](../scripts/release/definition.ts) and
[model schemas](../scripts/models/configuration.ts) remain the contract owners.
Extend them for selected behavior instead of layering another manifest system over them.
The [CLI guide](../deploy/local/installation.md#configure-without-prompts) owns runnable
configuration examples. Relative input paths resolve against their configuration file,
not whichever directory launches the CLI. Secret files are private and their contents
never appear in previews. Copying or editing a source key file does not silently rotate
an active credential.

Application and widget origins/ports and HTTPS certificate references are explicit.
The operator allocates and retains internal ports with collision checks. Raw Gateway,
controller, database, model-administration and browser-control ports must not become
public. External ingress requires a supported trust binding, not arbitrary proxy headers.

Published releases should pair GitHub Release downloads, checksums and notices with
GHCR images addressed by digest. The downloadable operator and release file must refer
to the same software, tools, recipe/model/connector data and pack payloads. Resolve a
published version once and pin it; never let later starts follow a moving latest tag.
The proposed default is latest stable for new installations, with an explicit version
override. Recipes belong to that selected release rather than choosing a different
runtime midway through setup. Final release-discovery policy remains to be confirmed.

Developer builds must produce the same layout. Keep local release/recipe overrides
as explicit CLI flags, not ordinary menu options or test-directory defaults. The
current component pins and operator archive are ingredients, not an already published,
complete downloadable release. Supported platforms must reflect actual testing.

Packs can contain several native Claws/agents and require models, capabilities or
connected accounts. Pack members are agent packages, not people. Reuse native preview
and lifecycle; show which content and permissions a selection requires. Existing
`research-team` content has two members and a model prerequisite. Release-indexed pack
resolution remains unfinished. Do not create a pack marketplace or invent a document
ingestion subsystem to make the example recipe sound complete.

## Changing a running installation

Preview the specific change, its affected settings, restart/data consequences and
secret references. Confirm explicit application; recheck ownership and current revisions
before writing. Stale observations require a new preview. Refresh only observes.

| Change                                         | Required behavior                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model defaults, enabled routes or keys         | Apply the selected fields and credential changes; preserve unrelated providers and agent overrides. Explicit reapply can restore selected defaults even if the saved file is unchanged. |
| Connections backend, keys or enable/disable    | Coordinate the service, plugin, scoped credentials and required policy changes. Preserve unrelated native edits and data; never reactivate a revoked credential on restart.             |
| Connection accounts and grants                 | Use the backend's account operations. Live account state belongs there, not in a recipe or copied installation JSON.                                                                    |
| Pack selections                                | Reuse native preview/apply/removal per member and check prerequisites. Report partial completion; do not replay uncertain creation.                                                     |
| Resources, exposure or software version        | Use supported stop/replacement/upgrade operations; do not imply live migration or a complete distribution upgrade from Gateway-only replacement.                                        |
| Identity issuer, storage location or ownership | Reject unsupported changes before writing. These require a separately designed migration, not a string edit that transfers users or data.                                               |

Ordinary restart preserves state and never reapplies defaults. The existing upgrade
feature stays; full release upgrades remain separate from capability reconfiguration.
No continuous reconciler should fight native administration.

## Implementation order and review boundaries

These are successive implementation slices, each requiring selection before work:

1. **Settings and navigation.** Put the recipe-filled menu first, Accept at the top,
   Esc exit at the root and credentials after settings. Add coherent model/provider/
   reasoning selection using validated metadata and the shared noninteractive inputs.
2. **Complete release inputs.** Build the development release from the checkout in
   one explicit command, package catalogs/packs and tools, and define the published
   download layout and version resolution. No production publication claim yet.
3. **Administrator setup and CLI authentication.** Implement the one-use OIDC owner
   link and authenticated CLI continuation. Preserve explicit unattended bootstrap
   and verify effective native authority, expiry, replay denial and revocation.
4. **Browser-guided account setup.** Reuse the Connections service for terminal-driven
   linking/reconnection/removal and progress. Settle how the server stays supervised
   while the terminal continues setup. Exercise real consent and callback failures.
5. **Reopen and manage.** Support coordinated capability changes through the installation
   document and shared commands, with preview/reapply and retained state. Add the
   selected ongoing People enrollment experience; keep role ownership native.
6. **Verify and publish.** Exercise a fresh installation and the later reopen/change/
   restart journey with the exact release artifacts. Test two-person team entry and
   revocation, inference and selected account use. Publish only the platforms and
   capabilities actually verified, together with images, downloads, checksums and notices.

Before their respective slices, decide the initial selectable model providers; the
ongoing People enrollment flow; the launcher/supervision mechanism; and final release
selection policy. The model default itself is already chosen. Refining Team documents
into a real recipe, choosing additional packs or requiring an account in a recipe are
separate product decisions, not prerequisites for improving the installer.

External hosting adoption, generic external ingress and directory-backed state remain
separate integration work. A hosting consumer owns allocation, identity/admission and
shared services; ClawScarf supplies the protected runtime without a second login or
People database. External ownership must be verified, not inferred from headers.
Those modes are not supported by the current unified schema. Standalone local
Connections depends on Access and cannot simply be combined with external entry.
Storage must preserve ownership and permissions; ZFS is not a ClawScarf requirement.
Consumer implementation belongs in its own repository.

The owner-managed upstream browser issue, Lobster/Codex choices, additional packs,
ClawHub curation, backup design and billing are outside these installation slices.
Vanilla ClawHub stays available. Do not turn this design or an automatic continuation
into authorization for any of that work.

## What the code provides today

The CLI already validates installation/release/recipe/model documents, generates
configuration, previews and prepares initial installations, and starts/stops retained
state. The menu and noninteractive configuration share defaults and private-file
writing. Component operations exist for models, packs and Connections. The companion
has Access and optional Connections APIs/pages, including account setup continuations.

The [current menu](../scripts/installation/installer/collect.ts) still asks for recipe
credentials before its review, keeps root Esc inside the installer, and accepts only
new installation directories. [Models](../scripts/installation/installer/sections/models.ts)
still exposes gateway modes/catalog files rather than the proposed model/provider
selection. [Connections](../scripts/installation/installer/sections/connections.ts)
asks for a catalog directory and does not guide account consent. OIDC still requires
an explicit administrator subject/email; the [Access component CLI](../services/access/runtime/cli.ts)
requires a supplied browser session file. The launcher is foreground-only.

The owner-claim link, supported CLI authentication journey, terminal account setup,
coordinated retained-install capability changes, complete build/download/publication
path and end-to-end recipe acceptance remain unfinished. Existing local component
tests do not prove this proposed journey. The [README](../README.md#current-verification-and-limits)
owns current verification and platform limits.
