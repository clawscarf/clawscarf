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
and Access plugins and both standalone browser surfaces; it does not produce an OpenClaw runtime image.
Plugin packages own their separate SDK dependency, build and acceptance commands.
The operator build also copies its [Python SDK transport](packs/transport.py) and
locked dependency inputs beside the compiled pack CLI through
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

The [local assembly](../deploy/local/README.md) uses `scripts/local.ts prepare`,
`start` and `login` for private state, supervised operation and local entry. It
has local acceptance evidence in that guide; clean-machine release qualification remains separate.
The compiled operator includes the Access and Connections migrations, component pins and sandbox
policy consumed by setup; the companion never runs setup migrations on startup.

The [unified installation CLI](../deploy/local/installation.md) is in `installation/`.
Its `installer/` module collects terminal answers, writes private initial configuration,
and calls the same plan/doctor/apply/start functions. It has no separate provisioning
engine. Run `pnpm clawscarf install` for the wizard or use the noninteractive commands.

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

The opt-in archive acceptance extracts into a temporary directory outside the
checkout, installs only frozen production dependencies and starts all four compiled
command entry points, verifies retained execution policies/notices, then renders model configuration without a provider call:

```sh
CLAWSCARF_TEST_OPERATOR_ARCHIVE=1 pnpm exec tsx --test scripts/package-operator.test.ts
```

The archive also passed retained-installation preparation and supervised startup
through verified native administrator access from an extracted directory outside
the checkout. Its migrations, policy and spawned controller/helpers were resolved
from that archive; the pinned images and controller binaries remained external inputs.
This packaging check is separate from a clean-machine runtime installation and
does not qualify a published release or an upgrade.

## Provenance

Adapted from RawClaw revision
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c):
[documentation checker](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/scripts/check-docs.ts),
[regression tests](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/tests/documentation.test.ts), root TypeScript,
ESLint and package configuration. The checker uses ClawScarf's task checklist and also
checks new files before they are staged. Strict typed lint covers the tooling;
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
repositories or services. Browser modules use their own UI modules and generated
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
