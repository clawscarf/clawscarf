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

## OpenClaw curation

The [curation design](runtime/curation.md) owns selection and acceptance requirements;
its [status table](runtime/curation.md#current-status) separates implemented work from
these open tasks. Establish retained administration before removing its old entry
points. These tasks do not authorize release publication or upstream PRs.

- [ ] **Configuration:** Set `gateway.cliAgents.enabled: false` in the preset;
      verify picker suppression and retained managed model routes.
- [ ] **Patch:** Add the native `agents.create` form and preserve the existing agent
      editor before removing or narrowing Custodian and its setup skills.
- [ ] **Patch:** Provide installed-only plugin administration and pinned npm
      installation, retaining custom skills, scoped MCP and the operator's local-artifact path.
- [ ] **Configuration + patch completion:** Select `marketplace.enabled: false` once
      retained administration works; remove remaining ClawHub promotion/setup references
      and cover independent marketplaces in retained harnesses. Reuse the existing native patch.
- [ ] **Patch + configuration:** Make core GitHub integration optional, covering
      account/session/tool APIs, previews, credentials and background OAuth; disable it
      in the base while preserving ordinary links and deliberate Git CLI use.
- [ ] **Patch:** Remove personal-device setup UI and backend entry points while
      preserving browser-node enrollment. Qualify identity/admission before admitting channels.
- [ ] **Patch:** Apply the remaining UI/settings selection, including provider onboarding,
      Labs, raw-config catch-all, extra workspace pages and promotion; cover routes/search/
      palette/contextual links and preserve People, optional Connections and native administration.
- [ ] **Patch:** Remove competing upstream self-update UI and gate its backend operations;
      keep runtime version ownership in ClawScarf releases.
- [ ] **Packaging:** Inventory and qualify the candidate plugin/skill selection and
      dependency closure; exclude unwanted files before final image layers, and reject
      unexpected built-ins or route/feature additions during upgrades. Preserve required Lobster.
- [ ] **Recipe + packaging:** Select and exercise document-analysis tools and skills;
      decide whether their executable dependencies justify an additional runtime image.
- [ ] **Verification:** Run the existing two-patch source through release-candidate CI;
      local source tests do not qualify the patched images on both architectures.
- [ ] **Verification:** Qualify the complete curated image against the design's acceptance
      cases, including explicit plugin/MCP lifecycle, user-addition retention and zero unwanted
      catalog traffic. Verify artifact provenance and update publication status when released.

## Future decisions

- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify changed-upstream-version upgrades and external hosting adoption,
      including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups.
