# Contributor guide

## Scope and documentation

- Work only on the owner-selected slice. A TODO, proposal, experiment or automatic
  continuation does not authorize more work. Stop at the agreed review boundary.
  Optional capabilities never become release gates without an explicit decision.
- [README.md](README.md) owns product boundaries and verified status; component
  READMEs own implementation and runnable instructions. [TODO.md](TODO.md) is the
  only task checklist: short unchecked bullets for unfinished work and future
  decisions. Remove completed tasks after the promised verification. No parallel
  plans, frozen documents, prose changelogs or archived status reports.
- **Keep every maintained document accurate with every change and every commit.**
  Review source, contracts, configuration, tests and actual deployment evidence,
  not memory or previous answers. Check the entire documentation set for affected
  claims, paths and commands before committing, even for code-only changes. Fix
  inconsistencies in that same change; never defer documentation cleanup.
- Describe implemented, experimentally tested, packaged and deployed behavior
  separately. Passing unit tests does not qualify a customer journey. Preserve
  unique open requirements before deleting superseded material. Use relative links;
  explain behavior once and link its owner. Logs/reports belong in ignored .local/
  or CI artifacts. Keep necessary manifests, lockfiles and immutable DB migrations.
- Reuse reviewed source and its regressions instead of rebuilding from summaries.
  Preserve pinned provenance and license notices in the relevant documentation and
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Product code and configuration
  must be standalone, without donor product names or runtime dependencies.

## Ownership and security

- Keep OpenClaw vanilla. It owns agents, roles, tools, conversations and mutable
  native configuration. Apply presets once; refresh only observes. Explicit
  reapplication replaces selected settings with confirmation and preserves unrelated
  edits. No duplicate role database or replacement native dashboard.
- One installation serves one trusted team, with shared execution files/browser
  accounts and distinct native users/roles. OpenShell retains externally owned
  Gateway/worker protection. Declare actual execution locations; do not infer
  hostile-tenant isolation from containers or safe actions from MCP/skill visibility.
- Preserve agreed security foundations in designs, schemas, examples and installers.
  OpenShell Gateway protection, the separate protected shared worker and authenticated
  entry/admission/revocation are fixed product requirements, not feature flags or recipe
  choices. Resource sizing and external ownership do not make those protections optional.
  Optional capabilities cannot weaken them; unsupported hosts/combinations must fail,
  not fall back. Distinguish current developer-component flexibility from the intended
  product contract. Validate example combinations against actual service dependencies;
  a proposed UX or unqualified integration must not become an accepted requirement.
- Ingress owns entry and session revocation; OpenClaw owns application permissions
  and execution. Do not filter native RPC methods or periodically disconnect valid
  streams. Verify effective native authority, identity freshness and last-admin
  constraints. UI hints never authorize writes.
- Services use typed ports; repos own domain SQL; providers own vendor I/O and wire
  formats; runtime handlers are thin. Composition owns wiring and lifetimes. Use
  private domain modules, not speculative packages, forwarding layers or registries.
  No cross-domain private imports. Enforce dependency direction mechanically.
- Access and Connections have separate ownership. Connections remains optional:
  absent configuration requires no provider key, schema, calls or unusable UI/tools.
  Explicitly enabled invalid configuration fails visibly. Do not couple either
  feature to a hosting control plane or add new separation machinery without a need.
- Connector additions use catalog data and the generic importer, never provider-
  specific runtime branches or patched schemas. Provider tool schemas are advisory;
  validate our envelopes. Preserve small search/describe/call tools, exact account
  selection, scoped credentials, grants and explicit outcomes. No implicit MCP rewrite.
- Keep secrets out of source, images, browser payloads and logs. Shared provider
  credentials and controller sockets stay outside OpenClaw. Log allowlisted fields.
  Stop/restart preserves data; retained volumes are not backups or rollback guarantees.
- Recipes belong in deploy/, payloads in runtime/, extensions in plugins/, native
  pack content in packs/. Ship explicit payloads and pinned artifacts, not research
  or customer state. Initialize server identity and private state separately.

## Implementation and verification

- Installer menus collect and present; shared CLI operations own configuration and
  effects. Keep capability-specific prompts in their modules, preserve answers across
  sections, and offer equivalent noninteractive operations. Recipes are validated data,
  not scripts or a second deployment engine. Example recipes are not qualified workflows.
- Maintain only the current contract: no legacy aliases, permissive old inputs or
  compatibility machinery unless the owner requests it. Preserve failure and data
  integrity guarantees; update callers, tests and docs together.
- Prefer maintained libraries and public extension points. Change OpenAPI first for
  REST; generate clients/handler types, validate actual routes, and share clients
  between browser/CLI. No handwritten parallel transport catalog or operation list.
- Keep strict TypeScript and typed lint. Validate unknown data; no any, unsafe casts,
  broad suppressions or ignored promises. Expected failures have owner-defined codes
  and retry semantics; adapters translate once, never by interpreting vendor messages.
  Domain errors are HTTP-independent. Preserve uncertain outcomes, serialize
  conflicting effects and never blindly replay mutations or invent queues.
- Use parameterized pg, explicit transactions and node-pg-migrate. Never migrate on
  API startup; migrations are immutable and run with separate credentials. Test
  retained data, concurrency and failed-migration rollback when persistence changes.
- Reuse the existing UI primitives. Keep forms reusable, actions beside their data,
  layouts consistent and text concise. Show loading in affected content, retain data
  during refresh and distinguish unavailable from empty. No architecture commentary
  as UI copy. Review changed desktop/mobile states and accessible pending/error flows.
- Review every changed file. Run `pnpm check`, `pnpm build` and relevant real boundary
  tests; dependency-rule changes need allowed/forbidden import regressions. Check
  docs semantically as well as with `pnpm docs:check`. State what remains unverified.
  No repeated broad audit or test loop without a new finding that warrants it.
- Make coherent commits, preserve unrelated work/notices, and push only when
  authorized. Never modify donor deployments. Installer and capability work follows
  the owner-selected scope; a future idea or handoff does not authorize it.
