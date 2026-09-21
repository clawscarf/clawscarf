# Membership changes without Gateway restarts

## Intent

Let a trusted-proxy team enroll, change or remove a member while unrelated users
remain connected to the same Gateway. ClawScarf enrollment writes native
`gateway.auth.trustedProxy.allowUsers` and `gateway.auth.identityScopes` before
and after assigning a native role. Those writes must hot-apply instead of
restarting the shared Gateway or revoking every user's authenticated connection.

This downstream patch has no dependency on the marketplace or browser patches.
Do not submit it upstream without the owner's explicit request.

## Required behavior and boundaries

- Hot-apply only these membership paths. Preserve existing behavior for auth mode,
  trusted proxies, required proxy headers, shared secrets and all other settings.
- Bind authenticated trusted-proxy connections to their own admission and identity
  grant. Equivalent scope/allowlist ordering and changes to other people must not
  disconnect them. Changed grants or removed admission retire the affected
  connection, with future connections evaluated against current native policy.
  Preserve native roles, last-administrator protection and targeted role revocation.
- Recheck delayed handshakes, requests and write authority against committed
  identity policy. A provisional or rejected configuration publication must not
  irreversibly revoke an otherwise valid connection or authorize new privileges.
  Structural credential revocation and existing policy-writer response handling
  remain effective, including during asynchronous publication.
- Bind signed trusted-proxy plugin cookies to the verified identity's policy;
  never trust an unsigned identity. Preserve freshness checks after asynchronous
  authentication/profile work and invalidate cookies for removed or changed users.
- Preserve full shared-generation checks for device tokens and cookies without a
  trusted-proxy identity. Do not globally remove the allowlist from the credential
  fingerprint. Independently authenticated token/password/device clients retain
  their original credential behavior. Tailscale identities retain scope freshness.
- Keep matching semantics: exact identity first, existing email-only case-insensitive
  scope fallback, exact trusted-proxy allowlist matching. Do not change empty-list
  semantics, introduce another role database, or filter native RPC methods.
- Access still owns external admission and revocation. No live installation,
  deployment, upstream pin or ingress trust boundary changes are part of this patch.

## Acceptance and adaptation

Run a real isolated Gateway with an administrator connected continuously. Enroll a
second identity through config writes, assign a native member role, grant and reduce
scopes, reorder equivalent grants and remove admission. Assert no administrator
socket close, no Gateway restart, correct member permissions, targeted disconnects
and rejected reconnection after removal. The test must fail on the original
restart plan before it can restart its test runner.

Exercise in-flight requests and mutation authority during prepared, rejected and
committed policy publication. Cover delayed handshakes, shared credential rotation,
identity scope ceilings, signed-cookie integrity, cross-user changes and post-await
revocation. Run the owning Gateway tests, production/test type checks and full
OpenClaw build, then export and verify exact patch replay and ClawScarf checks.
A source-level regression is not evidence that an existing installation has upgraded
or that hosted signup/invitation delivery succeeds; qualify the released image
separately before claiming either.

On upgrade, inspect the runtime publication owner and auth-generation lifecycle.
Prefer upstream's committed-policy owner if the architecture changes. If upstream
already meets these contracts, retain the regressions and remove the redundant
patch. Never replace a publication fence with a provisional global config read or
weaken revocation just to keep a test connected.
