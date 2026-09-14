# Contributing to ClawScarf

ClawScarf is in its design and runtime-validation stage. There is no installable
release or application test command yet. The [plan](PLAN.md) is the single list of
open work; [AGENTS.md](AGENTS.md) defines engineering and review conventions.

Start with one concrete outcome and a small change. For work based on RawClaw,
copy the relevant implementation and regression tests, record its source revision,
and adapt the standalone boundary. Do not rebuild working mechanisms from a summary.
For upstream behavior, identify the exact version you inspected or exercised.

Describe what the change does, how it was verified, and what remains unverified.
Update the owning documentation in the same change. Preserve third-party notices;
contribute only material you have permission to provide under the applicable license.
Never include credentials, customer data or generated run logs.

Useful early work includes runtime compatibility, identity and stream-revocation
checks, realistic dependency definitions for packs, and concise operator documentation.
A passing startup check alone is not a security or end-to-end acceptance result.
