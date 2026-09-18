# Recipes

Recipes are bundled with the CLI. Each folder contains a [recipe.json](team-documents/recipe.json), validated by
[the recipe schema](../scripts/installation/recipes/definition.ts).

```text
recipes/team-documents/recipe.json
runtime/releases/0.1.0-dev.json
packs/research-team/pack.json
```

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

`clawscarf configure` lists the bundled recipes. `--recipe team-documents` skips that
menu; `--recipe /path/to/recipe.json` uses a custom definition. Both use the same
validation and editable settings. `clawscarf recipes` lists available choices.
Recipe changes never reconfigure an existing server automatically.

**Team documents is an example:** GPT-6 Astra through OpenAI, medium reasoning,
hosted login, Connections enabled, browser off, and no packs selected. It does not
yet supply a document ingestion or question-answering workflow. That work remains
separate in [TODO.md](../TODO.md).

See [runtime and package distribution](../release/README.md).
