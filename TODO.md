# TODO

## Browser

- [ ] Qualify administrator browser file transfers in released macOS ARM64 and
      Linux ARM64/x86-64 installations before enabling browser by default.
      [Current support](deploy/execution/browser-node/README.md#verified-release-limits).

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
- [ ] Rename `ClawScarf People` to `People` in the manifest and registration.
- [ ] Remove personal-device setup, Talk and direct-provider account setup/settings.
      Keep managed models, selected channel setup and browser-node pairing.
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

- [ ] Qualify installation milestones in an instrumented CLI/runtime release: real ready setup and human response, restart deduplication, runtime opt-out, and PostHog receipt.
