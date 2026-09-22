# Optional native marketplace

## Intent

Maintain a native `marketplace.enabled` setting that defaults to enabled in
OpenClaw. When false, remove native marketplace discovery and promotion from
the UI and model-facing tools, and reject catalog-backed operations before
network requests or persistent side effects. ClawScarf can select false without
replacing OpenClaw's chat, identities, tools or extension lifecycle.

This is distribution policy, not an upstream bug claim or an instruction to
submit an upstream PR. The patch implements the setting; selecting its value
belongs to ClawScarf's configuration. No other patch in this series is required.

## Required behavior

- Keep the setting in native schema, labels/help, Advanced tier metadata and
  configuration documentation links.
- Hide plugin/skill discovery routes and links, search and recommendation cards,
  ClawHub Apps promotion and catalog-driven setup recommendations. Unknown initial
  configuration must not trigger discovery requests or misroute an enabled UI.
- Enforce the decision in Gateway RPC/HTTP handlers, CLI, agent tools, onboarding,
  updates and catalog owners. Include official-catalog fallback and cached catalog
  icon routes; do not merely hide buttons or filter RPC at ingress.
- Omit automatic remote inventory enrichment and marketplace skill instructions.
  Preserve installed plugins when skipping marketplace-backed updates.
- Preserve native authorization, installed inventory and management, explicit
  npm/local/Git installation, custom skill authoring, configured MCP, and ordinary
  chat. Disabled marketplaces must not imply that these deliberately supplied
  extensions are forbidden.
- Preserve default-enabled upstream behavior. Document restart requirements
  rather than inventing runtime compatibility or policy copies.

## Boundaries

This patch does not physically remove bundled packages, curate every channel or
provider setup choice, rewrite publishing templates, or control an independently
installed harness's marketplace. It is not a shell/network security boundary.
The [inventory patch](curated-image-inventory.prompt.md) owns package selection;
the [channel setup patch](curated-channel-setup.prompt.md) aligns channel discovery
with installed plugins. [TODO.md](../../../TODO.md#openclaw-curation) owns unfinished
curation, and the [distribution guide](../README.md) explains the general approach.

Do not import broad configuration loading into low-level catalog/worker modules:
that previously pulled unrelated runtime assets into the worker deployment.
Owners load and pass configuration; shared HTTP transport can read the published
runtime snapshot, with explicit policy admission at cold CLI entry points.

## Acceptance and adaptation

Inspect the current upstream UI, catalog, onboarding, tool and transport owners
before adapting. Search for new discovery/install paths, not only conflict markers.
Use existing native boundaries and the smallest equivalent change. Preserve
meaningful tests even if their original filenames or implementation disappear.

Verify enabled and disabled behavior, initial UI bootstrap, direct discovery and
mutation RPCs, cold CLI calls, promotion listing/claiming, icon HTTP routes, tool
schemas and prompts, catalog-to-npm onboarding fallback, inventory and updates.
Demonstrate a successful explicit-source install while disabled, and zero native
marketplace requests using an isolated local request trap. Run the full OpenClaw
build, including its worker bundle, type checks and relevant unit/browser tests.

The original experiment's real Gateway smoke rejected plugin/skill search and
promotion discovery while retaining installed inventory. Its UI screenshots and
logs are development evidence, not proof that a later source revision or image
works. Requalify affected contracts after changes.

If upstream supplies an equivalent feature, verify the full contract before
dropping this patch. If intent cannot be preserved, report the concrete gap;
do not weaken requirements or restore marketplace access to make tests pass.
