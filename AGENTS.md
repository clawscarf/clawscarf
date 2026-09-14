# Contributor guide

Adapted from [RawClaw's contributor guide](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/AGENTS.md).
Preserve its engineering standards while adapting runtime ownership and scope.

## Read the owners

[README.md](README.md) owns setup and verified status; [PLAN.md](PLAN.md) owns the
initial design and single task checklist. Local READMEs own implementation detail
and reuse provenance. [CONTRIBUTING.md](CONTRIBUTING.md) is the human entry point;
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) owns incorporated-material attribution.
Create focused specification/architecture owners when real
implementation warrants them, moving detail and linking rather than copying.
Keep entry points short and navigable. Explain behavior once in its owner.
Keep only current documentation, open work and future ideas. History belongs in git;
no frozen archives, superseded plans or dated copies. Applied database migrations
remain immutable data-integrity artifacts.

Documentation must reflect actual state with every change and in every commit.
Before every commit, review the staged diff and entire maintained documentation
set for affected claims, paths, commands and references, even if no document was
initially changed. Verify against source, contracts, configuration and acceptance
evidence, not memory or earlier answers. Fix inconsistencies in the same commit.
Use repository-relative links and pinned donor references; label local-only evidence.
Never document a proposed command or deployment as already available.

Reconcile PLAN.md against implementation and original decisions with every change.
Use `- [ ]` for unfinished work; remove completed tasks only after promised acceptance.
Preserve unique open requirements before deleting superseded material. An API, fake
credential or passing local test does not establish a usable UI, released artifact
or qualified customer journey. Keep runnable instructions in one owner. Logs,
per-run reports and downloaded research belong in CI or ignored .local/; required
runtime manifests, lockfiles and reproducible tests belong in source.

## Reuse and boundaries

- Start from existing RawClaw source and tests for capabilities it already owns.
  Copy/extract and adapt the working implementation; do not rebuild it from prose
  or invent a replacement because its composition includes hosting policy. Follow
  the [reuse map](PLAN.md#rawclaw-reuse-map). Record donor commit, paths, notices
  and deliberate omissions in the destination owner's README. Copy relevant
  regression tests with the implementation and rerun them in the new composition.
- Inspect dependencies before copying. Replace RawClaw organization, admission,
  host and deployment wiring with explicit standalone boundaries while preserving
  authorization and failure guarantees. Keep the donor functional until a separately
  authorized consumer migration; do not create permanently duplicated runtime
  defaults. Do not copy secrets, state or generated run reports.
- OpenClaw owns agents, native roles, conversations, tools, files and mutable
  configuration. Keep it vanilla and use native formats and supported interfaces.
  Apply presets once, then observe native changes. Explicit reapplication may replace
  selected settings after confirmation; preserve unrelated edits. Refresh never writes.
  Verify effective native authority before marking access ready. Ingress owns entry
  and session revocation; native code owns application permissions and execution.
  Never enforce revocation by periodic disconnects or filtering native RPC methods.
- Organize each companion's backend by domain, with types/, service/, repo/,
  providers/ and runtime/ only where needed. Services use typed ports; repos own
  domain SQL; providers own SDK adapters; runtime owns thin handlers. Composition
  and entry points own wiring and lifetimes. No cross-domain private imports,
  catch-all barrels, flat prefix families or empty layer scaffolding. Use private
  modules; do not create separate npm packages just to separate domains.
- Domain ports own inputs/outcomes. Vendor SDKs, wire formats, device conventions
  and direct I/O stay in adapters. Providers do not import each other's implementations.
  Shared HTTP/database mechanics own neither policy nor domain SQL; framework-free
  primitives stay separate. Parse environment only at composition. Check dependency
  direction mechanically, including global fetch and subprocess I/O.
- Expected failures have typed, owner-defined codes and retry semantics. Translate
  external failures once; never classify vendor messages. Domain errors contain no
  HTTP status; HTTP owns Problem Details, request IDs and safe detail. Preserve
  uncertain completion. Record intent for resumable external effects, serialize
  conflicting writes and never blindly replay mutations. This does not authorize
  introducing a queue or worker without a concrete requirement.
- Authorize named permissions against current credentials/resource facts in owning
  services, inside mutation transactions where applicable. UI hints never authorize
  writes. Preserve observed revisions, last-administrator constraints, identity and
  admission freshness, and revocation at execution boundaries. No parallel native-role
  database or silent authority from unrelated operator roles.
- One installation serves one trusted team. OpenShell is an unqualified candidate
  here, not proof of hostile-tenant isolation or universal sandbox coverage. Native
  plugins are executable code; MCP is a protocol and skill visibility is not shell
  authorization. Declare and test actual execution locations and authority.
- Keep credentials out of source, images, browser payloads and diagnostics. Log
  allowlisted fields. Never expose shared-provider credentials or host/controller
  sockets to OpenClaw. Optional integrations work unconfigured with no provider calls
  or unusable tools/actions; explicitly enabled invalid settings fail clearly.
- Keep recipes in deploy/, runtime payloads in runtime/, extensions in plugins/ and
  pack content in packs/. Ship explicit payloads and exact qualified artifacts;
  exclude build inputs and research. Initialize identity/private state separately.
  Packs may contain multiple agents, skills, plugins and workflows. Reuse upstream
  formats; resolve dependencies, network permissions and account bindings.
- Connector additions are catalog data plus a generic importer, never toolkit-specific
  runtime branches or patched provider schemas. Validate transport/tool envelopes;
  provider schemas are advisory. Preserve the small search/describe/call surface,
  exact account selection and explicit outcomes. No unrequested MCP rewrite.

## Implementation

- This is a new product: maintain only the current contract. No legacy paths,
  compatibility aliases, permissive old inputs, silent coercion or migration adoption
  for superseded implementations unless explicitly requested. Update callers, tests
  and docs together. Preserve data-integrity and failure guarantees.
- Use maintained libraries and documented extension points for infrastructure,
  parsers, routers, validation and generation. Reuse RawClaw's tooling when applicable;
  add abstractions for concrete callers, not speculative registries or frameworks.
- For REST surfaces, change OpenAPI first and generate handler/client types. Reuse
  RawClaw's Fastify/OpenAPI integration; use $ref, not YAML aliases. Browser and CLI
  share generated clients. Validate requests/responses and test registered routes;
  no parallel operation inventory or handwritten transport catalog. Do not invent
  REST services where upstream commands/configuration already meet the need.
- Reuse Commander for CLI parsing and React/Vite/TanStack Query for extracted browser
  surfaces. Adapt existing Kora-derived primitives and resource forms, keeping routing
  separate. Do not rebuild native OpenClaw screens. Keep layouts, actions and refresh
  consistent; no architecture notes or internal readiness flags as UI copy. Show loading
  in affected content, retain data during refresh, distinguish unavailable from empty,
  and provide accessible focus/error feedback. Review changed pages/dialogs at
  desktop/mobile sizes and terminal flows interactively.
- Keep strict TypeScript and typed ESLint. Use unknown and validate external data;
  no any, unsafe assertions, broad suppressions or ignored promises. Check transferred
  JavaScript with strict JSDoc types and lint; isolate generated exceptions. Type SQL
  results. Reuse parameterized pg and node-pg-migrate when extracting Postgres code:
  explicit transactions, immutable forward migrations, separate migration credentials,
  never migration on API startup. Test retained data and failed-migration rollback.

## Finish the slice

Work only on the owner-selected slice. A backlog item, assistant-authored design or
continuation does not authorize another feature or audit. Stopped or deferred
acceptance does not authorize filling time with another task. Do not publish, select
a project license or modify donor deployments without authorization.

Runtime and integrations first; interactive terminal installer last. Keep underlying
build/run/configure steps reproducible without the wizard. Define the user outcome,
supported configuration, interfaces, permissions, failure/resumption and acceptance
before implementation. Backend-first is an order, not feature completion. Keep the
parent task unchecked while required UI or target-environment acceptance is missing;
report deliberately deferred surfaces explicitly.

Review every changed file and run relevant checks, build and real integration tests.
Port RawClaw's applicable type/lint, generated-drift, documentation and Dependency
Cruiser checks alongside extracted code; do not claim commands exist before they do.
Changes to dependency rules need allowed/forbidden import regression cases. Test
failure boundaries, not just implementation-shaped examples. Report what ran and
what remains simulated/unverified. Preserve notices and unrelated work. Make small
coherent commits and push when authorized; do not defer quality to a future rewrite.
