# OpenClaw distribution and patches

ClawScarf maintains Git mail patches against the exact OpenClaw source revision
in [components.json](../../release/components.json). The ordered [series](patches/series),
patch files and matching intent documents are the release inputs. The same manifest
records the expected patched Git tree. A development checkout can always be
reconstructed; keep it while working, and export changes before discarding it.

The [series](patches/series) is the patch inventory. Each matching intent document
owns its feature requirements; [native configuration](../README.md#capability-controls)
owns preset choices. This guide owns editing and upgrading the stack, not feature
status or publication. See [release evidence](../../release/README.md#release-evidence)
for what shipped and [TODO.md](../../TODO.md#openclaw-curation) for open work.

## Configuration, patches and packages

ClawScarf retains OpenClaw's native chat, agents, files, tools and administration.
The distribution selects built-ins while allowing administrators to deliberately
add plugins, skills and MCP servers. Native Lobster is required, People mandatory
and Connections optional. Curation preserves the [team security boundary](../../README.md):
runtime code holds Gateway authority; native roles and UI controls are not
isolation from that code. Entry/revocation and outer protection remain external.

Use existing configuration when it covers the behavior, source patches for missing
feature controls, and packaging to exclude files. These mechanisms are distinct:

| Mechanism            | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Native configuration | Controls availability/eligibility; files remain installed and administrators can change the setting           |
| Source patch         | Changes the owning UI/backend implementation; hiding navigation alone does not disable RPC/HTTP, CLI or tools |
| Package selection    | Determines shipped files and dependencies; a disabled catalog or missing executable does not remove them      |

Use the [preset and capability guide](../README.md#capability-controls) for native
configuration semantics. `gateway.controlUi.root` can serve separately built UI
assets, but does not disable backends or remove the need to maintain compatible UI.

Optional-looking features are not necessarily plugins. GitHub account/session/tool
integration, previews and OAuth background work have core owners. Device pairing
has plugin, core RPC and HTTP entry points; it is distinct from teammate enrollment.
[Browser enrollment](../../deploy/execution/browser-node/operator.ts) uses native
bootstrap-token and pairing operations. Messaging channels are alternative inbound
conversation paths with their own identity/admission rules, not merely Connections.

Feature patches keep one native availability decision shared with the UI. Cover
direct routes, search/palette/contextual links, prompts, RPC/HTTP, CLI/tools,
background work and outbound calls. Disabled operations reject before effects;
document restart requirements. Preserve shared administration APIs, native
authorization and required attribution; do not add ingress RPC filters or a
replacement dashboard/role database. New feature requirements start in TODO and
move into paired patch intents as implemented.

`OPENCLAW_EXTENSIONS=codex` retains that optional extension alongside upstream's
default packaged set; it is not an exclusive image inventory. A catalog listing
does not prove a plugin is installed or active. Inspect package output, separately
downloaded artifacts, ClawScarf plugins and packs. Deletion in a later image layer
leaves bytes in inherited layers. Built-in selection and administrator additions
have different owners; inventory checks must not delete user-installed packages.

[Recipes](../../recipes/README.md) choose a pinned runtime and editable defaults;
[packs](../../packs/README.md) supply native files. Several recipes can share an
image; executable dependency differences can justify a variant. Skills do not
install their required CLIs. Gateway/local tools/shell/Lobster share the team
filesystem; the browser controller remains separate. Package downloads and MCP
transports remain subject to outer network policy, without controller authority
inside the runtime.

## Source of truth and order

One series line names one patch, in application order. Use stable descriptive
names rather than numeric prefixes; reordering changes the series, not every filename.
Each source commit must contain exactly one matching trailer, for example:

```text
ClawScarf-Patch: optional-marketplace
```

Each patch has a sibling intent document with the .prompt.md suffix describing the required behavior,
dependencies, preserved boundaries, verification and how to adapt or retire it.
These are maintained requirements for future agents, not build-time prompts.
Source patches and tests define the executable result; a prompt never silently
regenerates code during a build. If upstream changes substantially, an agent uses
the intent to prepare a reviewed replacement patch and new evidence.

Record dependencies in each patch intent. Maintain one supported order, not every
permutation or arbitrary recipe subset. Recipes select configuration and packages;
they do not independently reorder source patches.

## Prepare and work

Run the developer helper from the ClawScarf repository after installing its
development dependencies. It uses Git, Node and the existing TypeScript runner;
release CI does not require another patch tool.

```sh
node --import tsx scripts/openclaw-patches.ts prepare \
  --directory ~/clawscarf/openclaw-dev
```

The directory must not already exist. Preparation fetches the exact upstream pin,
applies every patch as a Git commit, checks the resulting tree and prints source
provenance. `--source /path/to/existing/openclaw` can use a local Git cache containing
that exact commit. It does not change the pin or copy uncommitted files.
`--provenance /path/to/result.json` saves the verified build metadata.

Edit and build the resulting OpenClaw checkout normally, using that checkout's
own package manager, dependencies and contributor instructions. Never share its
node_modules or build output with a differently patched checkout. Failures during
prepare leave the newly created checkout available for diagnosis; verify/export
use temporary checkouts and clean them after success or failure.

## Edit with Git or StGit

Ordinary Git works: create commits for new patches, amend the relevant commit or
use interactive rebase to edit earlier patches. Preserve the identity trailer and
replay all later commits. Each patch includes its relevant tests and upstream docs.

[StGit](https://stacked-git.github.io/) is an optional editing tool; version 2.6.0
was exercised with this workflow. It supplies named patches, refresh, push/pop,
reordering and rebasing. After preparation, initialize it in the OpenClaw checkout:

```sh
stg init
# Names are given newest first for these two commits.
stg uncommit browser-routing-guidance optional-marketplace
stg series
```

To edit the earlier patch, select it, edit source and tests, capture the edits,
then reapply the rest of the stack:

```sh
stg goto optional-marketplace
# Edit source files, then stage this patch's changes with git add.
stg refresh --index
stg push --all
```

Use the ClawScarf exporter below with either editor. Do not substitute StGit's
default export: it omits unapplied patches. Importing Git mail patches with StGit's
series mode also changes mail subjects; preparing with Git first avoids that
format mismatch. These differences were reproduced in a tool comparison.

## Export and review

Before exporting, the checkout must be clean and contain the complete, linear
stack over the pinned base. Any active StGit stack must have every patch applied,
including hidden patches. StGit must be on PATH when exporting a StGit-managed
checkout so the helper can inspect that state.

```sh
node --import tsx scripts/openclaw-patches.ts export \
  --directory ~/clawscarf/openclaw-dev
node --import tsx scripts/openclaw-patches.ts verify
```

Export generates stable Git mail patches, replays them in a fresh checkout and
compares the exact source tree with the development checkout **before** replacing
the saved patches and updating the expected tree. Verify reconstructs only from
the saved inputs. Wrong order, missing/extra commits, dirty source, unknown files,
missing intent, failed application and an unexpected tree are errors.

For a new patch, add its filename to the series and write its matching intent,
then create the source commit with that identity trailer and export. Export allows
the new patch file to be absent until generated. To remove a patch, remove its
source commit, series entry and both files together. To reorder patches, reorder
the source commits and series together, resolving dependencies before export.

Review a normal ClawScarf PR containing the patches, intent changes, source-tree
pin and any related configuration/build changes. Keep new configuration options
and the preset values that use them in the same change. No fork branch or open
upstream PR is a release input. Store incomplete local work safely; only exported,
committed inputs are reconstructible from ClawScarf.

## Upgrade upstream

On a separate ClawScarf branch, choose the new upstream revision and update
`sourceRevision`. In the development checkout, move the patch stack onto that
revision using Git rebase or StGit rebase. Resolve conflicts deliberately; never
skip a patch just to complete the build. Inspect the intent and current upstream
behavior before dropping a patch already implemented upstream.

Export updates the expected tree after exact replay. Run relevant upstream tests,
type checks, full build and ClawScarf acceptance against the reconstructed source.
A clean application cannot detect a newly introduced marketplace path or unwanted
built-in; requalify implemented feature contracts and review the
[pending inventory requirements](../../TODO.md#openclaw-curation). Upgrade
candidate automation and a real newer-upstream qualification are not implemented
by this initial workflow; the tooling trial exercised conflicting synthetic bases.

## Release and verification boundaries

The [release builder](../../scripts/release/build-images.sh) prepares this exact
source before the existing Docker build. Both architectures must agree on the
reconstructed revision, tree and patch-set digest. Candidate assets include
source provenance and the exact patches/intents; these are validated against
the candidate checkout before packaging. [Release documentation](../../release/README.md)
owns publication. The browser-node controller still uses its separately pinned,
published upstream image; these patches are built into the Gateway source image.

The [provenance generator](../../scripts/openclaw-patches.ts) records upstream and
reconstructed commits, the source tree, ordered patch/intent hashes and the complete
patch-set digest. The archived inputs include the series and every patch/intent pair.

The source tree is the identity of code contents, not a claim of bit-for-bit
reproducible Docker images. The patch-set digest also covers intent documents and
series order. Git import uses a fixed committer and author dates so reconstructed
revision metadata agrees across builders; user Git identity/environment is ignored.

Feature verification requirements belong to each patch intent. Reconstructed-source
checks and image acceptance are different boundaries; use the
[release evidence](../../release/README.md#release-evidence) for a published candidate.
No existing installation is modified by prepare, export or verify.
