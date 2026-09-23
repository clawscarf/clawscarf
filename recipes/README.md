# Recipes

Recipes are bundled with the CLI. Each folder contains a [recipe.json](team-server/recipe.json), validated by
[the recipe schema](../scripts/installation/recipes/definition.ts).

```text
recipes/team-server/recipe.json
recipes/personal-assistant/recipe.json
runtime/current.json
packs/research-team/pack.json
```

Each recipe has an ID and a version. Accepted installations retain that provenance
alongside their actual settings; a CLI update never reapplies new defaults. Bump the
recipe version when its defaults, pack selections or explicit runtime reference change.
The resolved runtime release is retained separately; automatic advancement of the
[current selection](../release/README.md#published-and-development-use) does not change recipe defaults.

A recipe's `runtime` points to an exact runtime definition, relative to the recipe
file. Runtime images and tools are fixed; its other fields are defaults that users
can change in the settings menu or through CLI flags. Recipes cannot disable
OpenShell protection or authenticated entry, admission and revocation. They contain
no executable hooks, secrets or user identities.

- `models` selects AI `service` (`cloud` or `provider`), model ID, provider and
  reasoning from the bundled [model catalogs](../deploy/models/README.md#installer-choices).
  Omitted `service` selects provider billing for existing custom recipes.
- `defaults` selects the initial `agentName`, resources, public web access, browser and Connections enablement.
  The name configures OpenClaw's default agent once; later renaming belongs in OpenClaw.
- `packs: [{ id, members }]` selects agents from the bundled [packs](../packs/README.md).
  The installer checks members and collects required credentials after settings review.

`clawscarf configure` lists the bundled recipes with their descriptions, then repeats
the selected description above its settings. `--recipe personal-assistant` or
`--recipe team-server` skips that menu; `--recipe /path/to/recipe.json` uses a custom definition. All use the same
validation and editable settings. `clawscarf recipes` lists available choices.
Recipe changes never reconfigure an existing server automatically.

Choose **[Personal assistant](personal-assistant/recipe.json)** to start on your own,
or **[Team server](team-server/recipe.json)** to start a shared workspace.
Both currently use the same runtime, model, resource and capability defaults, with
the same default agent and no recipe-specific prompts or packs. People and invitations
remain available in both; Personal assistant can welcome teammates later.
The recipe files own the exact defaults; `clawscarf recipes` displays the bundled selection.
Document workflows are separate
[open work](../TODO.md#openclaw-curation).
Cloud AI is recommended and prepaid; Cloud login is free. Connections remains
optional and uses paid packs beyond the account’s allowance. No recipe promises
a particular free credit amount or changes an existing installation’s AI service.

See [runtime and package distribution](../release/README.md).
