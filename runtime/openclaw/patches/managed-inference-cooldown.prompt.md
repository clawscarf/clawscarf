# Managed inference recovers after recharge

## Intent and boundary

Treat the exact `clawscarf` provider as managed by its gateway, using OpenClaw's
existing provider-managed cooldown policy. Its scoped credential always targets
bundled or external LiteLLM; Cloud and the upstream provider own funding and
credential validity. OpenClaw must not keep that route locally disabled for ten
minutes after the owner adds credit or repairs its provider credentials.

Skip local auth-profile and inline-key cooldown writes and ignore previously
cached failures for this provider. Preserve the actual request's authentication,
funding rejection, native error wording and bounded per-request retries. Leave
every other provider's policy unchanged; do not add direct-provider routes,
payment UI, credential rotation, new settings or state stores.

This downstream patch has no dependency on the other patches. Do not submit it
upstream without the owner's explicit request.

## Verification and adaptation

Exercise the embedded runner across a billing failure and the next funded attempt
without advancing time. Cover an older stored inline billing cooldown and retain
the direct OpenAI billing cooldown regression. Run the auth resolution, usage and
persistence suites, production/test type checks, build and exact patch replay.
The provider-attempt fixture proves local recovery, not live payment settlement;
qualify payment followed by native chat against a packaged runtime separately.

On upgrade, reuse the upstream owner of provider-managed auth health. Remove this
patch if native configuration or a public provider contract can express the same
behavior for ClawScarf; preserve the regression and gateway authority.
