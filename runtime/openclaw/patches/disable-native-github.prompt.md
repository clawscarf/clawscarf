# Disable native GitHub integration

## Intent and dependencies

Disable OpenClaw's built-in GitHub integration throughout the ClawScarf runtime.
Apply after `remove-cloud-workers` in the recorded series: that patch removes the
publication lifecycle with worker hosting, while this patch disables the retained
GitHub consumers. Do not rebuild a publication service or restore worker hosting.
Keep this feature boundary separate from browser artifacts and worker removal.

The runtime launcher sets `OPENCLAW_NO_GITHUB=1` on every invocation, including
retained installations. A native policy helper owns this decision; the UI follows
Gateway method advertisements. Changing a fresh-install preset alone is insufficient.
There is no user-facing GitHub enablement switch. The default upstream behavior
outside the ClawScarf launcher remains unchanged; only the complete distribution
stack and launcher are a supported ClawScarf execution path.

## Required behavior

- Omit native GitHub account, tool and publication RPCs, authenticated preview and
  pull-request discovery methods, and remote GitHub project import from the native
  method catalog and registry. Reject direct integration helpers before credential
  reads or outbound effects. Reject GitHub project URLs and retained pending imports
  before clone/materialization effects.
- Hide account linking, agent GitHub identity, GitHub settings/search entries and
  chat publication/PR controls. Do not fetch hidden data or authenticated hover
  previews. Ordinary GitHub links remain clickable without a preview service.
  Omit managed GitHub controls from form schemas without changing canonical
  validation, secret redaction or retained configuration.
- Do not construct OAuth lifecycle services, refresh native GitHub credentials or
  clean up managed GitHub profiles on startup. Omit native GitHub tools from both
  agent registration and tool discovery, and reject retained tool instances.
  Do not add native GitHub co-author instructions to agent prompts.
- Do not select/inject managed GitHub profiles or author credentials into shell
  execution. Preserve existing preview-secret exclusions so disabling integration
  cannot expose those secrets through the generic exec environment.
- Preserve deliberate Git/`gh` commands and separately supplied credentials, local
  projects/worktrees, ordinary chat, browser operation, and shared GitHub transports
  used for other purposes such as native login identity verification. This is feature
  deactivation, not a network prohibition or isolation from trusted runtime code.
- Preserve existing configuration, account records and credentials without migration
  or deletion. Shared authentication SecretRefs retain their existing validation.
  Retained records do not enable the disabled native integration.

## Verification and maintenance

Exercise a real Gateway startup with retained GitHub settings: ordinary session
creation and chat history work, native GitHub methods are absent and direct calls
fail, and OAuth/profile/token-probe background effects do not start. Exercise direct
preview/read/OAuth helpers and agent tools with the policy disabled. Run real local
Git execution and verify deliberate shell credentials survive while managed profile
injection and preview-secret export do not occur.

Review desktop/mobile chat, profile and agent settings with disabled method
advertisements, including retained GitHub identities, clickable links and no hidden
GitHub RPCs or co-author preference reads. Keep enabled
upstream sibling tests and exact patch replay passing. Run native type checks/build
and ClawScarf checks/build. Distinguish source verification from image publication
and deployment; do not change a running installation as a test fixture.

On upgrades trace new GitHub entry points and background owners rather than removing
every file or URL containing GitHub. Keep shared code and types where needed. Retire
the patch when upstream exposes an equivalent complete integration control, carrying
the same distribution policy and regression coverage forward.
