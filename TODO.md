# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.
This list covers the open-source ClawScarf distribution. Cloud-service work belongs in its own repository.

## Installer and releases

- [ ] Verify hosted login and real model inference on Linux ARM64/x86-64, and the full
      installation journey on Windows through WSL2. Native Linux CI covers protected
      runtime startup, private model routing, stop/start and deletion.
- [ ] Add Intel Mac support when compatible upstream OpenShell tools are available;
      the pinned release supplies no Intel Mac binaries.
- [ ] Finish release distribution review: transitive licenses/source obligations,
      durable acquisition of pinned OS packages and a self-contained Python prerequisite
      for optional pack operations. The basic Team server recipe selects no packs.

## Upgrade decision

- [ ] Decide how installed servers should move to a new ClawScarf release while keeping
      their data and configuration. Review the existing [runtime replacement](deploy/deployment/README.md#runtime-upgrade)
      before deciding what to reuse or remove; it replaces only the OpenClaw runtime,
      not the other services. Ordinary stop/start must continue to preserve data.

## Browser qualification

- [ ] Qualify ordinary model-selected member/admin browsing with the downstream
      [routing guidance fix](deploy/execution/browser-node/README.md#upstream-browser-routing-bug)
      in exact release images, preserving explicit target semantics, unavailable-node
      failure and network confinement. Source regressions pass; live model acceptance
      and workspace/browser file transfer remain unverified. Keep the Team server recipe's
      browser off until qualified. Upstream submission requires the owner's explicit request.

## Future decisions

- [ ] Curate the built-in plugin/channel/skill surface and remove ClawHub mentions.
      Keep user-added plugins/MCP possible; evaluate document dependencies per recipe.
      Native Lobster is required. Use the [curation findings](runtime/curation.md)
      for the candidate base, retained administrator paths and implementation order.
      Qualify the exact image inventory before removing packages; preserve native ownership.
- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify changed-upstream-version upgrades and external hosting adoption,
      including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups.
