# Repository checks

Run from the repository root with Node 24.16 or later in the Node 24 line, or Node 26.1 or later and
pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm connectors:plugin:setup
pnpm access:plugin:setup
pnpm build
pnpm check
```

The root build compiles repository tooling, companion TypeScript and the Connections
and Access plugins and the standalone Connections browser surface; it does not produce an OpenClaw runtime image.
Plugin packages own their separate SDK dependency, build and acceptance commands.
Connections configuration tests use private copies of plugin metadata and source entry files,
so they do not depend on compiled plugin output being present during a build. Compiled
plugin loading is exercised by the plugin’s native tests.
The operator build also copies its [Python SDK transport](packs/transport.py) and
locked dependency inputs beside the compiled installation operator through
[build-operator.ts](build-operator.ts). These files belong to the operator artifact,
not the OpenClaw runtime image. The selected operator Python environment must install
the pinned SDK dependencies as described in [pack setup](../packs/README.md).

[check-docs.ts](check-docs.ts) checks tracked and unignored new Markdown files for
relative file links, heading anchors, documented root pnpm commands and completed
tasks in [TODO.md](../TODO.md). It does not establish behavioral accuracy or check
remote links. [Its regression tests](check-docs.test.ts) cover missing/moved targets,
invalid anchors, machine-local paths, stale commands and nested checklist entries.

[Dependency rules](../.dependency-cruiser.cjs) keep plugins and companion services
independently deployable: they communicate through protocols, not private source
imports. [Boundary tests](architecture.test.ts) exercise both allowed local imports
and forbidden cross-component imports. Circular and unresolvable imports fail too.

[Generated drift checking](check-generated.ts) regenerates the access REST client,
Fastify types and Connections client from their contracts and compares exact output.
Generated code has isolated lint/format exceptions; handwritten code stays checked.
The companion fetch SDKs are compiled separately by [tsconfig.sdk.json](../tsconfig.sdk.json)
because its generator does not support exact optional property checking. The main
project retains that check and consumes their generated declarations.

The public CLI uses [deployment operators](../deploy/deployment/README.md) in `deployment/`
for private state, container lifecycle and administrator entry. Local verification is
described there; clean-machine release verification remains separate.
The build clears its compiled output first so removed source files cannot survive in an archive.
The compiled operator includes the Access and Connections migrations, component pins and sandbox
policy consumed by setup; the companion never runs setup migrations on startup.

The [unified installation CLI](../deploy/deployment/installation.md) is in `installation/`.
[Setup](installation/setup.ts) owns recipe defaults; [options](installation/options.ts)
validates explicit command-line selections;
[configuration writing](installation/save.ts) owns private files. The `installer/sections/`
modules collect feature-specific answers; shared prompts render the revisitable menu.
`configure` handles both new and existing installations, interactively or with explicit
noninteractive flags. It calls the shared validation, preparation and change operators;
there is no separate provisioning engine.
Recipes and packs are CLI assets from [recipes](../recipes/README.md) and [packs](../packs/README.md).
Each recipe pins a runtime definition in [runtime/releases](../runtime/releases/0.1.0-dev.json).
Run `clawscarf configure` after linking the development command below.

## Development command

After installing the checkout's dependencies, expose its CLI on your PATH:

```sh
pnpm link
clawscarf --help
```

pnpm's global binary directory must be on your PATH. If you already use a different
user binary directory, select it with `pnpm link --config.global-bin-dir="$HOME/.local/bin"`.
The command uses Node from your PATH, which must meet the version requirement above.
To bind only this command to a specific Node installation, use an editable dependency
with an explicit interpreter instead:

```sh
pnpm add --global --config.global-bin-dir="$HOME/.local/bin" \
  --config.node-exec-path=/absolute/path/to/node "link:$PWD"
```

The linked [launcher](clawscarf.mjs) runs this checkout's TypeScript source with its
local dependencies from any working directory. CLI source edits take effect on the
next invocation without rebuilding or relinking. Relative command arguments resolve
from the caller's directory. `pnpm clawscarf` uses the same launcher without a global link.
Changes to container contents still require rebuilding the affected images.
The [operator archive](#operator-archive) continues to ship compiled JavaScript and
does not need this development launcher or tsx.

## Operator archive

After a fresh build, package the explicit compiled operator payload into a new
ignored output directory:

```sh
pnpm exec tsx scripts/package-operator.ts --output .local/operator-artifacts
```

The command uses the system tar utility and emits a development `.tgz` plus `SHA256SUMS`.
It refuses an existing output directory. The archive includes its frozen dependency
lockfile, required migrations/policies/SDK clients, browser seccomp profile, native
browser-node helpers/private-ingress configuration, Python transport and notices; it
excludes companion servers, contributor tooling and installation state. It does not
download images, include provider credentials, publish a release or build missing
components. Its README links to the included [archive instructions](../release/operator.md).
The shared [runtime package writer](release/runtime-package.ts) builds operator and
companion manifests/lockfile importers from their executable dependency closures.
The publisher scans staged JavaScript imports, rejects missing relative modules,
and derives the operator's production dependencies by following imports from its
command entrypoints. Remote-executed helpers remain explicit payloads; their SDKs
belong to the target images. The archive
manifest and lockfile importer contain that same subset; publishing tools are not shipped.

The opt-in archive acceptance extracts into a temporary directory outside the
checkout, installs only frozen production dependencies and starts the compiled
command entry points, verifies retained execution policies/notices, then renders model configuration without a provider call:

```sh
CLAWSCARF_TEST_OPERATOR_ARCHIVE=1 pnpm exec tsx --test scripts/package-operator.test.ts
CLAWSCARF_TEST_COMPANION_PACKAGE=1 pnpm exec tsx --test scripts/package-companion.test.ts
```

These packaging checks alone do not establish installation/startup acceptance.
The first candidate also passed a fresh installation, hosted administrator login,
real inference and retained-state restart on the development Mac; see
[release verification](../release/README.md#build-and-publish). Published release
upgrades and a newly provisioned host remain untested.

## Provenance

Adapted from RawClaw revision
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c):
[documentation checker](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/scripts/check-docs.ts),
[regression tests](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/tests/documentation.test.ts), root TypeScript,
ESLint and package configuration. The checker uses ClawScarf's task checklist and also
checks new files before they are staged. Strict typed lint and dependency-direction rules cover the tooling;
The extracted access and Connections services, UI and generated contracts are checked;
unrelated donor hosting and billing commands are not copied.
The API generator configurations and drift checker also reuse RawClaw's root
OpenAPI generation configuration and [generated drift checker](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/scripts/check-generated.mjs), adapted to
the access, Connections service and plugin broker contracts here. Dependency rules describe ClawScarf's
current component boundaries rather than copying the donor's absent service tree.

## Dependency layers

The executable rules cover both companions. `types/` and `shared/` cannot import
implementations; `service/` uses those ports and its own service modules, never
repositories, providers, transports or generated API models. `repo/` owns SQL and
uses domain ports, while `providers/` owns external adapters and cannot import
repositories or services. Browser modules use the shared [UI primitives](../ui/shadcn/components/ui/button.tsx) and their own generated
REST clients. Entry/composition modules wire these layers. Portable `runtime/`
payloads cannot import companions, plugins or host tooling.

The Connections HTTP composition uses only the access companion's public
[session port](../services/access/types/native.ts). Its browser uses the generated access client.
Other cross-companion source imports fail. The process app explicitly wires the
access configuration/composition and native ports to the Connections composition,
HTTP registration, catalog provider and typed errors. These named entry boundaries
are allowlisted; companions cannot import the process app. Plugins communicate through protocols
and remain independently packaged. Domain layers cannot import network, filesystem,
subprocess, database or authentication infrastructure. Typed lint also blocks global
`fetch`, `WebSocket` and `EventSource` in those domain layers. The regression fixture checks
allowed port imports, forbidden layer inversions and the named public access seam.

Root type/lint/build includes `runtime/**/*.ts`; tests include access, Connections,
models, packs and runtime suites. Native tests retain their explicit environment
flags. The access UI plugin has its own install/build/check commands, and upstream
`plugins build --check` verifies its generated artifact. Generated directories are
excluded from formatting; source OpenAPI contracts remain formatted and generated
clients are checked for drift.

Shared frontend primitives and theme live in `ui/`; they cannot import service or operator code. Both browser builds consume those same sources. Operator internals cannot import CLI entrypoints or installation menus, and service access is restricted to named composition/configuration/storage boundaries. Import regressions cover permitted and forbidden directions.

Retained installation editing uses `clawscarf configure --directory <installation>`; its
noninteractive flags share the same operations. Validation and preview/apply stay internal. See the
[installation guide](../deploy/deployment/installation.md#change-an-existing-installation)
for supported changes, persistence and failure handling.

The [cloud client guide](../services/cloud/README.md) owns API snapshot provenance
and regeneration instructions. Hosted browser authorization and registration live
in `scripts/cloud/`. Custom OIDC bypasses hosted login registration; optional hosted
Connections still registers independently.
