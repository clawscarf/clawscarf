# Recipes

Recipes are bundled with the CLI. Each folder contains a [recipe.json](team-server/recipe.json), validated by
[the recipe schema](../scripts/installation/recipes/definition.ts).

```text
recipes/team-server/recipe.json
runtime/releases/0.1.0-dev.json
packs/research-team/pack.json
```

Each recipe has an ID and a version. Accepted installations retain that provenance
alongside their actual settings; a CLI update never reapplies new defaults. Bump the
recipe version when its defaults, pack selections or runtime pin change.

A recipe's `runtime` points to an exact runtime definition, relative to the recipe
file. Runtime images and tools are fixed; its other fields are defaults that users
can change in the settings menu or through CLI flags. Recipes cannot disable
OpenShell protection or authenticated entry, admission and revocation. They contain
no executable hooks, secrets or user identities.

- `models` selects model ID, provider and reasoning from the bundled
  [model catalog](../deploy/models/catalog.json).
- `defaults` selects resources, browser and Connections enablement.
- `packs: [{ id, members }]` selects agents from the bundled [packs](../packs/README.md).
  The installer checks members and collects required credentials after settings review.

`clawscarf configure` lists the bundled recipes. `--recipe team-server` skips that
menu; `--recipe /path/to/recipe.json` uses a custom definition. Both use the same
validation and editable settings. `clawscarf recipes` lists available choices.
Recipe changes never reconfigure an existing server automatically.

**Team server:** GPT-6 Astra through OpenAI, medium reasoning,
hosted login, Connections enabled, browser off, and no packs selected. It supplies
a basic team server, not a document ingestion or question-answering workflow. A future document recipe remains separate in [TODO.md](../TODO.md).

See [runtime and package distribution](../release/README.md).
