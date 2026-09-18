import { OperatorError } from "../errors.js";
import { dirname, join } from "node:path";
import { openPack } from "../packs/source.js";
import type { Release } from "./definition.js";
import type { Recipe } from "../installation/recipes/definition.js";

/** Packs remain native file trees; recipes only select bundled members. */
export async function verifyReleasePacks(
  release: Release,
  releaseFile: string,
  recipes: readonly Recipe[] = release.recipes,
) {
  const packs = new Map<string, Awaited<ReturnType<typeof openPack>>>();
  for (const entry of release.packs) {
    const pack = await openPack(join(dirname(releaseFile), "packs", entry.id));
    if (pack.manifest.id !== entry.id || pack.digest !== entry.digest)
      throw new OperatorError(
        `Release pack does not match its digest: ${entry.id}`,
      );
    packs.set(entry.id, pack);
  }
  for (const recipe of recipes) {
    const selected = new Set<string>();
    for (const entry of recipe.packs) {
      const pack = packs.get(entry.id);
      if (!pack)
        throw new OperatorError(
          `Recipe ${recipe.id} requires missing pack ${entry.id}.`,
        );
      for (const id of entry.members) {
        if (
          selected.has(id) ||
          !pack.manifest.members.some((member) => member.id === id)
        )
          throw new OperatorError(
            `Recipe ${recipe.id} has an invalid or duplicate pack agent: ${id}`,
          );
        selected.add(id);
      }
    }
  }
}
