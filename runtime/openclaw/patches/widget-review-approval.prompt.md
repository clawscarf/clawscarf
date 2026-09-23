# Widget reviews can request human approval

## Intent and boundary

Keep a dashboard widget pending when the native automatic reviewer asks for an
operator decision, fails, or cannot grant low-risk approval. Reuse the existing
Allow / Reject card and native authorization; do not activate the widget before
approval. Explicit denials remain rejected. Full, Guarded and Read only retain
their native behavior.

Explain the built-in `prompt` capability in the reviewer's trusted instructions:
it requires user interaction and sends a visible user message to the agent;
granting it skips the additional per-click confirmation. It can initiate actions,
so neither that name nor a widget's claim of benign intent proves low risk.
Unknown capabilities still require review. Do not change model routing, budgets,
Connections, Cloud, OpenShell or the installation's Workspace default.

Keep the bounded review reason with the pending or rejected widget in its existing
manifest and show it as plain text. Replace it with each new review and clear it
on widget replacement or a manual decision. Retain exact revision, instance and
current-authority checks. Public grant requests still accept only Allow or Reject;
only the internal reviewer may record a pending outcome. No new SQL schema,
approval store, permission database or old-widget repair is needed.

Apply after `remove-cloud-workers`: regenerated native protocol bindings also
reflect that patch's retired methods and fields. Do not submit this patch upstream
without the owner's explicit request.

## Verification and adaptation

Exercise the registered widget routes for low-risk approval, explicit denial,
uncertainty, reviewer failure and manual decisions. Verify pending widgets receive
no frame or view ticket, and that approved Refresh prompts use the existing host
bridge. Cover SQLite reload, layout changes, replacement, stale decisions and
reason removal. Check escaped reason rendering, desktop/mobile approval controls
and the Allow request in Chromium. Run native type checks/build, ClawScarf checks
and build, and exact patch export/replay.

On upgrade, retire this patch when upstream supplies the same human fallback and
capability context. Preserve explicit-denial handling and the native authorization
boundary when adapting it. Release evidence owns packaged and deployed status.
