# Installation recipes

Recipes supply release-owned configuration defaults. They are data validated by the
[recipe schema](../../scripts/installation/recipes/definition.ts); no scripts, secret
values, user identities or deployment paths belong here. The release generator embeds
these definitions in its output. There is no independent recipe version or live
inheritance: a saved installation records provenance and owns its complete settings.
Recipes select bundled packs with `packs: [{ id, members }]`; the release carries
their native file trees and digests. Setup rejects missing packs or members. The
Packs menu lists release packs, while explicit installation JSON may select a local
pack directory for development. See [release contents](../../release/README.md).

[Team documents](team-documents.json) is an illustrative starting point. Its model catalog
selects GPT-6 Astra through direct OpenAI with medium thinking; setup asks for the provider
key. The catalog is copied into the installation and remains customizable. Live provider
execution for this recipe is not yet qualified. It supplies no document
pack, ingestion system or validated question-answering behavior. Those are deliberately
outside the menu implementation. Connections and browser default to off.

The [installation guide](../deployment/installation.md#terminal-installer) owns commands.
Use `--recipes <directory>` to replace the release catalogue for development; JSON
files are loaded deterministically and duplicate/invalid IDs fail. `Custom` remains
available without recipe provenance. Recipe choices cannot disable OpenShell protection,
the protected team runtime or authenticated entry. Selected packs retain their existing
model/account prerequisites.
