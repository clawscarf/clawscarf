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
- Reuse reviewed implementations and regressions. Preserve upstream pins, licenses and
  provenance in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Product code must stand
  alone without donor-product dependencies. Never change donor deployments.

## Product and security boundaries

- Keep OpenClaw vanilla: it owns agents, roles, tools, conversations and native settings.
  Presets apply once; refresh observes. Explicit reapplication confirms selected changes
  and preserves unrelated edits. No duplicate role database or replacement dashboard.
- One installation serves one trusted team with separate native identities/roles and
  shared execution files/browser accounts. OpenShell protects the Gateway and separate
  shared worker under external control. These protections and authenticated entry,
  admission and revocation are mandatory, including in recipes. Unsupported combinations
  fail visibly. Containers and visible tools do not imply hostile-tenant isolation.
- Ingress owns entry and revocation; OpenClaw owns application permissions and execution.
  Do not filter native RPC methods or disconnect valid streams on a timer. Preserve
  identity freshness, effective native authority and last-administrator protection.
- Managed inference uses bundled or external LiteLLM; no direct-provider recipe bypass.
  Connections is optional and separately owned: when absent, require no provider key,
  schema, calls or unusable UI/tools. Enabled invalid configuration fails visibly.
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
  Recipes are validated defaults, not scripts or another deployment engine. Ask for missing
  required inputs, then review; put details under Customize. Keep equivalent noninteractive
  commands. Esc always returns to the parent screen; no Back menu rows. At the root it
  stays there. Save accepts section edits; Esc discards unsaved section edits and new
  secrets while retaining accepted answers. Ctrl+C exits.
- Reuse UI primitives. Keep actions beside data, layouts consistent and copy concise.
  Show loading in affected content, retain data on refresh, and distinguish unavailable
  from empty. Review changed accessible desktop/mobile pending and error states.
- Review every changed file. Run relevant regressions and documentation checks per slice;
  run `pnpm check` and `pnpm build` before handing off code changes. Test real affected
  boundaries where mocks cannot establish behavior, and state what remains untested.
  No repeated broad audit/test loop without a new finding. Never count moved code as deletion.
- Make coherent commits; preserve unrelated work and push only when authorized.
