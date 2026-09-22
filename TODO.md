# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.
This list covers the open-source ClawScarf distribution. Cloud-service work belongs in its own repository.

## Installer and releases

- [ ] Consolidate initial and retained network-policy composition; preserve unselected
      rules and operator address restrictions. Cover native endpoint shapes and both
      public-web toggle directions without inferring ownership from address-list equality.
- [ ] Validate public-web compatibility with configured private HTTPS model/Connections
      endpoints before reporting readiness; make the supported combinations explicit.
- [ ] Qualify clean-machine installation on supported hosts, hosted login and real
      inference on Linux ARM64/x86-64, and the full Windows/WSL2 journey.
- [ ] Qualify concurrent native UI requests and long-lived streams through the shipped
      gRPC service forwards and address the [controller connection limit](deploy/openshell/README.md#application-transport).
- [ ] Verify saved native dashboards and their granted network controls through the
      authenticated UI on the release image, including cold asset loading.
- [ ] Qualify hosted signup/email verification, recovery, logout and account switching,
      plus customer OIDC callbacks/TLS, on a fresh installation.
- [ ] Add Intel Mac support when compatible upstream OpenShell tools are available;
      the pinned release supplies no Intel Mac binaries.
- [ ] Finish release distribution review: transitive licenses/source obligations,
      durable acquisition of pinned OS packages and a self-contained Python prerequisite
      for optional pack operations.

## Upgrade decision

- [ ] Design whole-installation release upgrades that retain data and operator configuration.
      Ordinary stop/start must continue to preserve data.

## Browser qualification

- [ ] Add narrow native permission for member browser use without granting full
      administrator authority; preserve administrative node/profile controls.
- [ ] Fix download transfer between Chromium, browser controller and runtime while
      preserving network isolation and excluding team files/credentials from Chromium.
- [ ] Qualify member/admin browsing and upload/download round trips on macOS and Linux
      release images before enabling the recipe default. Preserve explicit target
      semantics and unavailable-node failure; see the [browser owner](deploy/execution/browser-node/README.md#verified-release-limits).
      Upstream submission requires the owner's request.

## OpenClaw curation

This scope selects the shipped packages and removes the named UI features below.
Keep existing native plugin management, custom skills and MCP. The
[distribution guide](runtime/openclaw/README.md) owns patch maintenance and the
[image guide](deploy/images/README.md) owns packaging. Broader redesigns are separate
[deferred decisions](#deferred-product-decisions). No release publication or upstream PRs
are authorized by this checklist.

### Retained skills

The shipped selection lives in the [distribution inventory](runtime/openclaw/inventory.json);
[image packaging](deploy/images/README.md) owns its application and verification.

- [ ] Change `skill-creator` instructions to use installed `python3` instead of `python`;
      exercise its packaged validator.
- [ ] Fix `taskflow` example paths to use packaged files rather than assuming the
      Gateway runs from the source checkout; exercise approval and resume.

### UI and configuration

- [ ] Qualify CLI-agent picker suppression and retained managed model routes in a
      released image using the [native preset](runtime/README.md).
- [ ] Document all configured settings, their purpose and source owners in
      [native configuration](runtime/README.md). Distinguish initial defaults,
      installation choices, administrator edits and restart/reapplication behavior;
      link exact values instead of copying them.
- [ ] Remove Cloud Workers navigation, settings, setup and provisioning operations,
      including background activity. Preserve the OpenShell team runtime.
- [ ] Remove native GitHub account linking/settings, account/session/tool APIs,
      authenticated previews, credential injection, profile synchronization and
      background OAuth from the base. Preserve ordinary links and deliberate Git CLI use.
- [ ] Remove Labs while preserving custom plugin UI for Account/People, optional
      Connections and administrator additions. Replace “Open Labs” links and enablement
      instructions; put any needed plugin-UI administration in Plugins.
- [ ] Rename `ClawScarf People` to `People` consistently in manifests, registration,
      settings and navigation. Keep `Connections`, stable plugin IDs and Account functionality.
- [ ] Remove setup/settings entries and operations for the removed capabilities,
      including personal-device/native-client setup, Talk and direct-provider accounts
      in Profile/model setup. Preserve managed LiteLLM model selection, selected channel
      setup and required browser bootstrap-token/pairing operations.
- [ ] Remove OpenClaw server Updates and disable upstream server self-update operations.
      ClawScarf releases own the runtime version; retain updates for administrator additions.
- [ ] Remove remaining marketplace entry points, especially `codex_plugins` in retained
      Codex, and ClawHub promotion/setup/publishing advice. Extend the existing marketplace
      patch while preserving required attribution and deliberate explicit-source installs.

### Completion checks

- [ ] Qualify the curated inventory on both released architectures, including no removed
      files in distributed layers or automatic first-use restoration. Check dependency versions,
      integrity and origins across upstream output, downloads and packs; reject unexpected,
      missing or duplicate entries. Preserve licenses and administrator additions.
- [ ] Update shipped docs/help, tool descriptions, prompts and skill instructions with
      each removal. Check direct routes, search, command palette, RPC/HTTP/CLI/tools,
      cached paths and cold-start/background activity: removed operations cause no effects
      or unwanted catalog traffic. Verify enabled/disabled states and required restarts.
- [ ] Verify the retained chat, uploads/files/artifacts, model selection, shell, Lobster,
      memory, agents, People/revocation and optional Connections on the exact image for
      members/admins and desktop/mobile, including loading/error states and restart.
      Absent Connections must need no UI/tools/calls/credentials; enabled invalid setup
      must fail visibly. Browser transfer qualification remains [separate](#browser-qualification).
- [ ] Verify existing plugin install/enable/invoke/reload/update/uninstall, skill
      authoring/upload/assignment and scoped stdio/remote MCP authentication and removal.
      Preserve native authorization, source trust, consent, install policy, integrity
      and atomic update publication. Reject ambiguous plugin IDs and unauthorized changes;
      test dependency downloads without widening egress or adding a package registry.
- [ ] Verify plugin disable/removal drops contributed skills and generated links after
      refresh/restart, including existing sessions. Preserve independent bundled/local
      copies and user additions/settings through restart and explicit recipe reapplication.
      Explain that image-bundled plugins require packaging changes, not normal UI uninstall.
- [ ] Qualify sender identity, admission, native authority and revocation before enabling
      retained channels or incoming automation. Keep Connections account grants separate.

## Deferred product decisions

These are outside the agreed curation scope; decide separately before implementation.

- [ ] Decide whether to remove/narrow Custodian and its setup skills. If selected,
      first provide native agent creation with the existing editor/workspace/tool/skill
      controls; preserve authorization and the native agent store.
- [ ] Decide whether to replace Advanced/raw configuration with explicitly selected
      admin/member settings and prevent new upstream sections appearing automatically.
      Review engines, hooks, commands and bindings as part of that decision.
- [ ] Decide individually whether to retain Dashboards, Activity, Meetings, Portals,
      Worktrees and cosmetic Lobsterdex; preserve useful visualization and Workboard.
- [ ] Decide separately on Gateway URL/token switching and unrelated About/Apps,
      community/download/browser-extension promotion; retain version, provenance and licenses.
- [ ] Select additional document/PDF authoring tools and skills only as a separate
      enhancement; package and exercise their executables on the team filesystem.
      Create a runtime variant only if executable dependencies justify it.

## Future decisions

- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify changed-upstream-version upgrades and external hosting adoption,
      including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups.
