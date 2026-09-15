# Contributing to ClawScarf

ClawScarf is implementing and validating its standalone runtime. There is no
qualified installable release yet. The [task checklist](TODO.md) is the single list of
open work; [AGENTS.md](AGENTS.md) defines engineering and review conventions.

Use the Node and pnpm versions in [package.json](package.json) and follow the
[contributor setup and checks](scripts/README.md). The two plugin builds have their
own locked development dependencies. Real database/native tests require the
environments described in the component READMEs. Passing these checks does not
establish that the distribution is ready to install.

Start with one concrete outcome and a small change. For reused work,
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
