import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "../scripts/installation/files.js";
import { recipesSchema } from "../scripts/installation/recipes/definition.js";

/** Load maintained recipe sources for release and configuration regressions. */
export async function loadRecipes(directory: string) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return recipesSchema.parse(
    await Promise.all(files.map((file) => readJson(join(directory, file)))),
  );
}
