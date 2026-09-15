# Remaining work

No task below starts automatically. The current handoff is for review; select the
next slice before implementation.

## Foundation acceptance

- [ ] Verify a fresh installation from packaged artifacts: login, model/tool response,
      retained state, stop/start, and operation with optional integrations disabled.
- [ ] Repeat the two-person OIDC, handover, revocation and widget journey from those
      artifacts; local source-based acceptance is recorded in the component READMEs.
- [ ] Verify optional Connections activation in the assembled runtime and one real
      external-account connection/tool call; disabled mode and protocol tests exist.
- [ ] Before publication: complete dependency/license review, configure private
      vulnerability reporting, publish exact artifacts and record platform/resource limits.

## Selected experiment — unfinished

- [ ] Review the separate browser-node design, then decide whether to finish its
      private ingress, DNS, pairing/revocation and native member-tool acceptance.
      Component code exists; it is not connected to the local operator. The current
      direct-browser path fails Gateway DNS preflight under OpenShell. Do not enable it
      as a supported capability or weaken confinement to bypass that failure.

## Future decisions

- [ ] Discuss installer choices before building the terminal wizard: optional
      Connections, model gateway, packs and bundled capabilities; keep unattended commands.
- [ ] Select capabilities individually. Lobster, Codex, additional packs and ClawHub
      curation are optional ideas, not foundation release gates. Preserve vanilla discovery.
- [ ] Qualify Linux/WSL and changed-upstream-version upgrades; current acceptance is
      macOS arm64 with Docker Desktop and retained-state replacement of the pinned runtime.
- [ ] Define adoption by external hosting platforms: identity/model/broker ownership,
      persistent mounts, UID mapping, source-bound authorization and revocation.
- [ ] Discuss independent Connections packaging if needed; current optional module
      shares the companion process and depends only on its public authentication ports.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retaining a volume is not a backup. Website, billing and fleet work are out of scope.
