# Browser routing guidance

## Intent

Make the model-facing browser tool description agree with OpenClaw's effective
configured routing. With an enabled configured browser node and no managed
sandbox browser taking precedence, ordinary calls should omit `target` and
`node`, thereby using the configured node. Do not advertise the Gateway host as
the default in that situation.

This is a downstream fix. Do not submit or publish it upstream unless the owner
explicitly requests that. It has no dependency on the marketplace patch.

## Required behavior and constraints

- Cover both lazy plugin registration and the direct runtime tool factory.
  Fix the description at its native owner, without inserting a separate system
  prompt or rewriting tool calls elsewhere.
- Preserve routing code and explicit `target: "host"` / `target: "node"`
  semantics. Host intentionally bypasses the configured node; it must not be
  silently redirected.
- Preserve managed sandbox precedence, existing-session profiles, tab-bound
  restrictions, automatic/manual/off node policies and host-control prohibitions.
- An unavailable configured node still fails visibly. Do not suggest or add a
  host fallback to evade that failure.
- Do not change SSRF, network rules, permissions, node pairing, credentials,
  browser profiles, shared files, or add another configuration option.

The [browser integration guide](../../../deploy/execution/browser-node/README.md#upstream-browser-routing-bug)
owns the deployment boundary: the Gateway and the separately networked browser
controller have different allowed connections. Moving shell execution into the
team runtime did not change those browser routes.

## Acceptance and adaptation

Inspect the current browser registration, shared description, tool factory and
routing owner before editing. If upstream consolidates them, implement the same
contract at the new owner rather than restoring old structure.

Regressions must first demonstrate the misleading original description. Verify
the registered lazy tool and direct factory agree. Exercise omitted target,
explicit node, explicit host, an unavailable configured node, managed sandbox
precedence, denied host/node control, node mode off, manual mode without a pin,
and tab-bound tools. Dispatch tests should invoke the real routing owner with
controlled transports, not duplicate its algorithm in tests.

Run the browser extension tests, node-host lazy-registration tests, production
extension type checks and full build. Before enabling browser by default or
claiming end-to-end deployment acceptance, separately exercise an ordinary
model-selected browsing turn with the real configured node and unchanged network
confinement. Deterministic guidance/dispatch tests alone do not prove that journey.

If upstream already meets this contract, preserve the regression and remove the
redundant patch. If adapting it would require a routing or permission change,
report that as a new decision instead of silently widening this patch.
