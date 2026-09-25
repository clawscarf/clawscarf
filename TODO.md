# TODO

## OpenClaw curation

Built-in selection is implemented in the [inventory](runtime/openclaw/inventory.json).
Remaining changes use the [patch series](runtime/openclaw/README.md); preserve
administrator-added plugins, skills and MCP.

- [ ] Fix `skill-creator` to invoke installed `python3` and run its packaged validator.
- [ ] Fix `taskflow` examples to find packaged pipelines from the runtime workspace;
      exercise approval and resume.
- [ ] Remove personal-device setup and Talk pages, routes and native setup actions.
      Keep browser-node pairing.
- [ ] Remove direct-provider account setup and Advanced provider settings; keep
      managed models and selected channel setup.
- [ ] Remove remote terminal-host/session execution choices; keep local terminals
      and browser-node operations.
- [ ] Remove remote Gateway, Tailscale and discovery setup from Infrastructure and
      native configuration; keep installation-owned local Gateway settings.
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
