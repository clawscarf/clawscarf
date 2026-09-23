# Keep plugin navigation selection current

Native plugin sidebar entries must update their selected styling and `aria-current`
when navigating between plugin pages, opening a core page, or using browser history.
The pinned UI reads the current URL during rendering but does not subscribe these
entries to route changes, leaving the previously opened plugin highlighted.

Subscribe navigation contributions to the existing router through the owning
subscription controller. Preserve native links, modified clicks, page registration
and lifecycle cleanup; add no plugin-side workaround, polling or routing layer.
There are no semantic dependencies on other patches; keep the order in `series`.

The native-plugin UI E2E regression must fail without the fix and pass with it:
open Connections, switch to Account and People, then Home, Back and Forward.
Verify both selection and its removal using the actual sidebar and router.
Retain inspected screenshots as test artifacts. Run relevant UI regressions,
UI type checks/build and exact patch replay before packaging.

Drop this patch when upstream navigation contributions already track route changes.
Do not submit upstream without the owner's request.
