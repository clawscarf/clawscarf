# Remove the Systems workspace

## Intent

Remove the core Systems page from the ClawScarf distribution for administrators
and members. This is source removal, not a sidebar preference or disabled catalog
entry. No new configuration switch is needed for this distribution decision.

The patch has no semantic dependency on the other patches; preserve the order
in `series`. Do not submit it upstream without the owner's explicit request.

## Required behavior and preserved boundaries

- Remove the Systems route, lazy page, machine sidebar, page-owned controller,
  styles and English catalog. Remove route/navigation/palette metadata, default
  pins, contextual links and shell exceptions used only by that workspace.
- Direct `/systems` navigation must not load its former page or start its machine
  inventory work. Follow the existing unknown-route behavior. Stale saved pins
  must be discarded by the normal supported-route parser.
- Remove obsolete feature tests and help, including contextual-sidebar machinery
  whose only production owner was Systems, including its Desktop inventory and
  embedded-toolbar overrides. Preserve ordinary session scrolling
  and shell-panel behavior. Regenerate owned boot and localization outputs with
  their normal tools.
- Preserve shared `node.list`, `environments.list`, `system.info`, node pairing,
  browser-node controls, Desktop panels and all their existing authorization.
  Removing this page does not disable these APIs or their other consumers.
- Preserve custom plugin UI, chat, Home, sessions, native settings and retained
  node management. Plugin/package curation and Home session policy are separate.
- No live installation changes, upstream pin changes or releases are implied.

## Acceptance and adaptation

Verify route registration, direct URL handling, sidebar defaults, stale saved pins
and command discovery. Exercise the built UI for member/admin and desktop/mobile:
Systems is absent from navigation, More, pin customization and command search;
old URLs do not mount the page or start its inventory requests. Confirm ordinary
chat and authorized node management still work. Retain sanitized before/after
screenshots as test artifacts, not maintained source documentation.

Run affected UI regressions and production/test type checks, localization checks,
full build and exact patch replay, followed by ClawScarf checks/build. Qualification
of a released image remains separate from source and mocked-transport UI proof.

On upgrade, search for new Systems entry points and page-owned background work.
If upstream adds an equivalent feature switch, evaluate whether it fully removes
the selected surface before replacing this deletion patch. Never disable shared
node/browser APIs to approximate removal of the page.
