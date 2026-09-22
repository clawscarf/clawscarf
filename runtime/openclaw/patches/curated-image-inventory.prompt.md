# Curated built-in image inventory

## Intent and owner

Make upstream Docker packaging support an explicit built-in plugin and skill
selection. ClawScarf's [inventory](../inventory.json) owns the selection, consumed
by its image builder and acceptance test. Keep this policy out of runtime loading:
administrators can still add plugins, MCP servers and workspace/local skills.
No source or semantic dependency on earlier patches; apply in series order.
The later [channel setup patch](curated-channel-setup.prompt.md) aligns native
setup/UI with the selected channel packages and records the channel choices.

## Required behavior

- `OPENCLAW_EXTENSIONS_ONLY=1` makes the existing `OPENCLAW_EXTENSIONS` selection
  exclusive. Default upstream builds retain their existing additive semantics.
  Resolve and validate IDs through the existing Docker selection owner. Install
  selected plugin dependencies, compile their entry points, and prune omitted
  source/dist/dist-runtime plugin roots and unshared runtime dependencies.
- `OPENCLAW_DOCKER_SKILLS` is an explicit list of native skill directory names;
  unset/empty preserves upstream behavior and `-` selects none. Apply to the
  standalone skills and plugin skill collections in package output. Validate the
  whole selection before mutation. Preserve retained manifests' collection roots,
  plugin-root documentation and all selected skill assets. Reject symlink escapes.
- Perform removals in the disposable runtime-assets stage before the final image
  copies them. Deleting files in ClawScarf's derived final image is insufficient:
  omitted packages must not survive in inherited layers.
- Remove CLI startup metadata computed from the full source inventory; native
  discovery reconstructs it from the surviving packages. Do not replace native
  plugin discovery, role checks or dependency linking with a second runtime owner.
- Preserve selected browser registration and skill, memory-wiki and its required
  memory-core API, document-extract worker and clawpdf. Lobster is separately
  packaged by ClawScarf and must not be bundled a second time. Preserve Codex's
  native bundled provenance and platform payload.
- Do not remove shared native APIs, browser pairing, MCP, custom UI, core GitHub
  integration or external catalogs as a side effect. Their separate curation
  requirements remain in TODO. Selection does not enable optional capabilities or
  prevent an administrator from deliberately reinstalling a removed package.

## Acceptance and adaptation

Run Docker selector/pruner/skill regressions, covering unchanged upstream defaults,
unknown selections, retained shared dependencies, newly introduced unwanted
plugins, plugin-owned skill removal, and user/workspace files left intact.
Build the actual source and derived images. ClawScarf's image inventory test must
match exact source and compiled plugin manifests, skills, and native plugin-list
results. Run its existing capability probe for Codex, Lobster and workspace skill
controls. Retain PDF/browser worker artifacts and use the existing native runtime
acceptance for full model-driven behavior; image inventory is not that proof.
Replay the exported series and run ClawScarf checks/build. Release-image and
multi-architecture qualification remain separate from a local build.

On upgrades review new packaging roots, dependency layouts and plugin skill paths.
Keep the explicit list authoritative; do not automatically retain new upstream
defaults. If equivalent upstream exclusive packaging becomes available, replace
this patch with that mechanism while retaining the same image acceptance.
