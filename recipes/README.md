# Recipes

Recipes are bundled with the CLI. Each folder contains a [recipe.json](team-server/recipe.json), validated by
[the recipe schema](../scripts/installation/recipes/definition.ts).

```text
recipes/team-server/recipe.json
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

- `models` selects model ID, provider and reasoning from the bundled
  [model catalog](../deploy/models/catalog.json).
- `defaults` selects resources, public web access, browser and Connections enablement.
- `packs: [{ id, members }]` selects agents from the bundled [packs](../packs/README.md).
  The installer checks members and collects required credentials after settings review.

`clawscarf configure` lists the bundled recipes. `--recipe team-server` skips that
menu; `--recipe /path/to/recipe.json` uses a custom definition. Both use the same
validation and editable settings. `clawscarf recipes` lists available choices.
Recipe changes never reconfigure an existing server automatically.

**Team server** supplies a basic team server. Its exact model, reasoning, resource,
capability and pack defaults are defined in [recipe.json](team-server/recipe.json);
`clawscarf recipes` displays the bundled selection. Document workflows are separate
[open work](../TODO.md#openclaw-curation).

See [runtime and package distribution](../release/README.md).
