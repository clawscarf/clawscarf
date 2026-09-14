# Contributor guide

## Scope and documentation

- Work only on the user-selected slice. A plan item is not permission to implement
  the next feature. Repository initialization does not authorize extraction,
  deployment, provider spending or changes to RawClaw installations.
- README owns current executable/released status. PLAN.md is the single initial
  design and task owner. Keep it concise and current; replace its design sections
  with links to focused owners when implementation justifies those documents.
  Do not create competing checklists or frozen copies.
- Check claims against source, upstream references and actual test evidence with
  every change and before every commit. Update affected documentation together.
  Remove verified completed tasks; preserve unfinished acceptance and future ideas.
  Distinguish proposed, implemented, locally tested and deployed behavior.
- No legacy aliases, speculative scaffolding or backward-compatibility code unless
  explicitly requested. Keep logs, downloaded research and per-run reports in
  ignored .local/ or CI artifacts. Keep required manifests and lockfiles in source.

## Ownership and quality

- OpenClaw owns agents, native roles, conversations, schedules and execution.
  Keep it vanilla and use supported extension/configuration interfaces. Reuse
  native formats and maintained libraries rather than building parallel engines.
- Reuse reviewed RawClaw/pilot code and tests where appropriate, recording donor
  revisions and license provenance. Do not copy the entire control plane or assume
  its deployed behavior qualifies a different runtime arrangement.
- Use cohesive private modules with typed boundaries. Keep vendor SDKs in adapters,
  policy in owning services and composition at entry points. No empty packages,
  forwarding layers or generic orchestration framework without concrete callers.
- Preserve structured failures and uncertain outcomes. Never blindly replay
  external mutations. Refresh observes; explicit reconfiguration preserves unrelated
  user edits. Defaults apply once to fresh state.
- Never bake credentials or customer state into artifacts. No shared provider keys
  or host/container-controller sockets in the OpenClaw runtime. Verify identity,
  account selection and revocation at the responsible execution boundary.
- MCP is an integration mechanism, not a universal security boundary. Native
  plugins are executable code; skill visibility is not shell authorization.
  Declare and test where every supported capability runs and what it can access.
- One installation serves one trusted team. Do not promise hostile-tenant isolation,
  prompt-injection immunity or universal sandbox coverage.

## Delivery

- Runtime and integrations first; interactive terminal installer last. Keep the
  underlying build/run/configure steps reproducible without the future wizard.
- Packs can contain multiple agents, skills, plugins and workflows. Resolve actual
  dependencies and account bindings; no connector-specific runtime patches or
  hand-repaired provider schemas. Reuse the small generic Connections tool surface.
- Review every changed file. Run checks appropriate to the actual change; add real
  boundary tests for behavior and failure paths. Do not claim completion from a
  manifest, route or passing mock test alone.
- Use small coherent commits. Do not publish, select an open-source license or
  modify donor deployments without authorization. Keep terminal/browser surfaces
  concise, consistent and accessible, with useful loading and error feedback.
