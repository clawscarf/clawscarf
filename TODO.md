# TODO

## First-run reliability

- [ ] Reproduce and fix blank pages, failed navigation and JavaScript download errors
      through the shipped Access/OpenShell path. Check a fresh browser cache, idle
      connections and multiple tabs against the [connection limit](deploy/openshell/README.md#application-transport).
- [ ] Verify a saved Dashboard opens and its granted network controls work through
      authenticated entry, without depending on a chat preview.
- [ ] Recheck invitation signup and callback failures with two separate browser
      sessions; confirm a new member can join without disrupting the administrator.

## Browser

- [ ] Allow members to browse without granting administrator access to node/profile
      management; exercise the native browser tool as both roles.
- [ ] Fix downloads stranded in Chromium's container; verify workspace upload/download
      round trips on macOS and Linux before enabling browser by default.
      [Current failures](deploy/execution/browser-node/README.md#verified-release-limits).

## OpenClaw curation

Built-in selection is implemented in the [inventory](runtime/openclaw/inventory.json).
Remaining changes use the [patch series](runtime/openclaw/README.md); preserve
administrator-added plugins, skills and MCP.

- [ ] Fix `skill-creator` to invoke installed `python3` and run its packaged validator.
- [ ] Fix `taskflow` examples to find packaged pipelines from the runtime workspace;
      exercise approval and resume.
- [ ] Remove Cloud Workers UI, provisioning and background activity.
- [ ] Remove native GitHub account linking, account/session/tool APIs, authenticated
      previews, credential injection and profile/OAuth background work. Keep ordinary
      links and deliberate Git CLI use.
- [ ] Remove Labs; retain Account, People, Connections and administrator-added plugin
      UI, with any required UI enablement control in Plugins.
- [ ] Rename `ClawScarf People` to `People` in the manifest and registration.
- [ ] Remove personal-device setup, Talk and direct-provider account setup/settings.
      Keep managed models, selected channel setup and browser-node pairing.
- [ ] Remove server Updates and upstream server self-update operations; keep updates
      for administrator-installed extensions.
- [ ] Remove remaining marketplace paths, including Codex's `codex_plugins` and
      ClawHub promotion/setup/publishing instructions. Keep explicit-source installs
      and required attribution.

## Installation and distribution

- [ ] Test hosted login and a real model response on Linux ARM64/x86-64 and
      Windows/WSL2 using the standalone installer.
- [ ] Exercise customer OIDC callbacks and logout over HTTPS with Connections disabled.
- [ ] Make optional packs usable without a separately installed host Python/OpenShell SDK.
- [ ] Inventory transitive licenses and source obligations for the CLI and release
      images; include any missing notices or source archives.
- [ ] Make pinned OS packages retrievable without relying on rolling Debian mirrors.
