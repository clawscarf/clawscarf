import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recipeSchema, recipesSchema } from "./definition.js";
import { readJson } from "../files.js";
import { modelCatalogSchema, modelIdentity } from "../../models/catalog.js";
import { openPack } from "../../packs/source.js";
import { recipeModelRoutes } from "../models.js";
import { InstallationError } from "../errors.js";
import { cloudModelsSchema, cloudModelCatalog } from "../../cloud/models.js";
import { defaultCloudUrl } from "../../cloud/url.js";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));

export async function readRecipe(file: string) {
  const recipe = recipeSchema.parse(await readJson(file));
  return { ...recipe, runtime: resolve(dirname(file), recipe.runtime) };
}

/** Small, local package assets. Runtime images and executables are separate artifacts. */
export async function installationCatalog(root = packageRoot) {
  const entries = await readdir(join(root, "recipes"), { withFileTypes: true });
  const recipes = recipesSchema.parse(
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) =>
          readRecipe(join(root, "recipes", entry.name, "recipe.json")),
        ),
    ),
  );
  let modelCatalog = modelCatalogSchema.parse(
    await readJson(join(root, "deploy/models/catalog.json")),
  );
  const cloudModels = cloudModelsSchema.parse(
    await readJson(join(root, "deploy/models/cloud-catalog.json")),
  );
  const supported = new Set(cloudModels.map((model) => model.id));
  modelCatalog = modelCatalog.filter((offer) =>
    supported.has(modelIdentity(offer)),
  );
  const cloud = cloudModelCatalog(cloudModels, defaultCloudUrl);
  // The bundled OpenRouter adapter accepts exact upstream IDs through Chat Completions.
  // Keep the curated snapshot as the boundary; never expose arbitrary vendor discovery.
  for (const offer of cloud) {
    const route = `openrouter/${offer.model.id}`;
    if (modelCatalog.some((candidate) => candidate.model.route.model === route))
      continue;
    const advertised = cloudModels.find((model) => model.id === offer.model.id);
    if (!advertised?.protocols.includes("chat/completions")) continue;
    modelCatalog.push({
      ...offer,
      provider: "OpenRouter",
      model: {
        ...offer.model,
        id: offer.model.id.split("/").slice(1).join("/"),
        api: "openai-completions",
        route: { model: route, apiKeyEnv: "OPENROUTER_API_KEY" },
      },
    });
  }
  modelCatalog.push(
    ...cloud.filter((offer) =>
      modelCatalog.some(
        (candidate) => modelIdentity(candidate) === offer.model.id,
      ),
    ),
  );
  const packEntries = await readdir(join(root, "packs"), {
    withFileTypes: true,
  });
  const packs = await Promise.all(
    packEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const directory = join(root, "packs", entry.name);
        const pack = await openPack(directory);
        return {
          id: pack.manifest.id,
          directory,
          members: pack.manifest.members.map((member) => member.id),
        };
      }),
  );
  if (new Set(packs.map((pack) => pack.id)).size !== packs.length)
    throw new InstallationError(
      "invalid_configuration",
      "Pack IDs must be unique.",
    );
  for (const recipe of recipes) validateRecipe(recipe, { packs, modelCatalog });
  return { recipes, packs, modelCatalog };
}

export function validateRecipe(
  recipe: Awaited<ReturnType<typeof readRecipe>>,
  catalog: Pick<
    Awaited<ReturnType<typeof installationCatalog>>,
    "packs" | "modelCatalog"
  >,
) {
  recipeModelRoutes(recipe.models, catalog.modelCatalog);
  const selected = new Set<string>();
  for (const entry of recipe.packs) {
    const pack = catalog.packs.find((pack) => pack.id === entry.id);
    for (const member of entry.members) {
      if (!pack?.members.includes(member) || selected.has(member))
        throw new InstallationError(
          "invalid_configuration",
          `Recipe ${recipe.id} selects a missing or duplicate pack agent: ${entry.id}/${member}.`,
        );
      selected.add(member);
    }
  }
}
