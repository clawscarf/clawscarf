# Installation recipes

Recipes supply release-owned configuration defaults. They are data validated by the
[recipe schema](../../scripts/installation/recipes/definition.ts); no scripts, secret
values, user identities or deployment paths belong here. The release generator embeds
these definitions in its output. There is no independent recipe version or live
inheritance: a saved installation records provenance and owns its complete settings.
Recipes select bundled packs with `packs: [{ id, members }]`; the release carries
their native file trees and digests. Setup rejects missing packs or members. The
Packs menu and --pack option select release-owned packs. See [release contents](../../release/README.md).

[Team documents](team-documents.json) is an illustrative starting point. It selects
`{ "model": "gpt-6-astra", "provider": "openai", "reasoning": "medium" }` from
the release model catalog. Limits, protocols and credential variables are defined only
in that catalog. Release preparation rejects missing or ambiguous offerings and unsupported
reasoning. Setup copies the resolved model settings into the installation and asks for
the selected provider key. The OpenAI Responses route passed a live GPT-6 Astra / medium chat through the
bundled model gateway. It supplies no document
pack, ingestion system or validated question-answering behavior. Those are deliberately
outside the menu implementation. Connections defaults to on and can be disabled in the
installer; accounts are linked afterward in OpenClaw. Browser defaults to off.

The [installation guide](../deployment/installation.md#terminal-installer) owns commands.
Use `--recipe <id>` to select a recipe from the supplied release; build a new development
release to test updated recipe definitions. `Custom` remains
available without recipe provenance. Recipe choices cannot disable OpenShell protection,
the protected team runtime or authenticated entry. Selected packs retain their existing
model/account prerequisites.
