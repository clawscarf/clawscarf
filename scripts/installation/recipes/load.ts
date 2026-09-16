import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "../files.js";
import { recipesSchema } from "./definition.js";

/** A developer override replaces the release catalogue; it never merges stale entries. */
export async function loadRecipes(directory: string) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return recipesSchema.parse(
    await Promise.all(files.map((file) => readJson(join(directory, file)))),
  );
}
