# Contributor guide

## Scope and documentation

- Work only on the owner-selected slice. TODOs, experiments and automatic continuations
  do not authorize more work. Stop at the agreed boundary; optional ideas are not gates.
- Keep every maintained document accurate with every change and commit. Check source,
  contracts, tests and deployment evidence, not memory. Fix affected claims, links and
  commands in the same change. Separate implemented, tested, packaged and deployed status.
- [README.md](README.md) owns product boundaries; component READMEs own usage and implementation.
  [TODO.md](TODO.md) is the only checklist: short unchecked items, removed when verified.
  No parallel plans, frozen reports or changelog prose. Preserve unique open requirements.
  Use relative links and one owner per explanation. Reports and logs belong in ignored
  .local/ or CI artifacts; retain required manifests, lockfiles and migration history.
- Update the [cloud runbook](https://github.com/clawscarf/clawscarf-cloud/blob/main/RUNBOOK.md) in the cloud repository
  whenever a change affects its configured integration, callbacks, credentials locations or
  deployment. Verify actual settings; keep secrets out and avoid duplicating the runbook here.
- Reuse reviewed implementations and regressions. Preserve upstream pins, licenses and
  provenance in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Product code must stand
  alone without donor-product dependencies. Never change donor deployments.

## Product and security boundaries

- Keep OpenClaw vanilla: it owns agents, roles, tools, conversations and native settings.
  Presets apply once; refresh observes. Explicit reapplication confirms selected changes
  and preserves unrelated edits. No duplicate role database or replacement dashboard.
- One installation serves one trusted team with separate native identities/roles and
  shared execution files/browser accounts. OpenShell protects the whole team runtime
  (Gateway, native plugins, shell and local tools) under external control. Code execution
  is trusted with Gateway authority; native roles are application controls, not isolation
  from other team members or administrators. Outer protection and authenticated entry,
  admission and revocation are mandatory, including in recipes. Unsupported combinations
  fail visibly. Maintain only this execution model; no legacy worker or migration path.
- Ingress owns entry and revocation; OpenClaw owns application permissions and execution.
  Do not filter native RPC methods or disconnect valid streams on a timer. Preserve
  identity freshness, effective native authority and last-administrator protection.
- Managed inference uses bundled or external LiteLLM; no direct-provider recipe bypass.
  Connections is optional and separately owned: when absent, require no provider key,
  schema, calls or unusable UI/tools. Enabled invalid configuration fails visibly.
- Installation configures services/plugins and establishes the first administrator.
  Teammate enrollment and external-account linking belong to application management,
  not the installer. Target People as mandatory native UI and Connections as optional
  native UI; keep Access and broker enforcement outside OpenClaw. Empty Connections
  is a valid installed capability, not an unfinished setup step.
- Target hosted login by default with customer OIDC always available; do not bundle an
  identity server. Login and Connections are independent choices. Connector quota or
  payment state must never gate team login. Keep future hosting consumers on the same
  scoped service contract, without a second signup or duplicated broker implementation.
- Connections uses a generic catalog/provider adapter and small search/describe/call tools.
  Preserve exact accounts, agent grants, scoped credentials and explicit outcomes.
  Provider schemas are advisory; validate our envelopes. No connector-specific repairs
  or implicit MCP rewrite. New capability choices must not weaken existing protections.
- Keep provider secrets/controller sockets outside OpenClaw, and all secrets out of
  source, images, browser payloads and logs. Log allowlisted diagnostics. Declare actual
  execution locations. Retained volumes and stop/start are not backup guarantees.

## Implementation and verification

- Prefer maintained libraries and public APIs. Each module needs a concrete responsibility
  and callers; do not create layers, registries, packages or persisted state by convention.
  Delete redundant mechanisms rather than moving them. Keep vendor I/O in adapters, SQL
  with its owning repository and wiring/lifetimes in composition. Enforce dependency
  direction, including tooling; do not import another domain's private implementation.
- Use strict TypeScript and runtime validation at untrusted boundaries. No `any`, unsafe
  casts, ignored promises or blanket suppressions. Keep domain errors HTTP-independent;
  translate structured dependency failures once, never by matching vendor messages.
  Serialize conflicting effects and preserve uncertain outcomes without blind replay.
- Maintain only the current contract: no aliases or backward compatibility unless asked.
  Define REST in OpenAPI, generate clients/handler types and validate real routes. Browser
  and CLI share clients. Use parameterized SQL, explicit transactions and separate
  node-pg-migrate execution/credentials; never migrate on API startup.
- CLI operations own configuration/effects; installer menus only collect and present.
  Recipes are validated defaults, not scripts or another deployment engine. Present the
  recipe-filled settings menu first, with Accept and continue at the top; request missing
  secrets afterward in the context of the chosen settings. Keep equivalent noninteractive
  operations and advanced details out of normal copy. Esc returns to the parent screen
  and exits at the root; no Back rows. Save accepts section edits; Esc discards unaccepted
  section edits and new secrets while retaining accepted answers. Ctrl+C exits. Keep
  runnable behavior and limits in the [CLI guide](deploy/deployment/installation.md), and
  unfinished work only in TODO.md; do not retain a parallel implementation plan.
- CLI output is for people by default; `--json` emits machine-readable results on stdout.
  Display commands as `clawscarf …`; never expose development launchers such as pnpm
  or TypeScript entry points in product messages.
  Keep progress and diagnostics on stderr, never mix them into JSON, and issue login
  credentials only during explicit login/administrator setup or the installer.
- Reuse UI primitives. Keep actions beside data, layouts consistent and copy concise.
  Show loading in affected content, retain data on refresh, and distinguish unavailable
  from empty. Review changed accessible desktop/mobile pending and error states.
- Clean up disposable test containers and networks after verification. Normal stop preserves
  an installation for restart; it is not cleanup of a completed test fixture.
- Review every changed file. Run relevant regressions and documentation checks per slice;
  run `pnpm check` and `pnpm build` before handing off code changes. Test real affected
  boundaries where mocks cannot establish behavior, and state what remains untested.
  No repeated broad audit/test loop without a new finding. Never count moved code as deletion.
- Make coherent commits; preserve unrelated work and push only when authorized.
