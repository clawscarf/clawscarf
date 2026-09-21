import { recipeModelRoutes } from "./models.js";
import type { Recipe } from "./recipes/definition.js";
import { resolve } from "node:path";
import {
  type InstallationConfiguration,
  type InstallationDraft,
} from "./configuration.js";
import { releaseSchema } from "../release/definition.js";
import { readJson } from "./files.js";
import { InstallationError } from "./errors.js";
import { SetupInputs } from "./save.js";
import {
  installationCatalog,
  readRecipe,
  validateRecipe,
} from "./recipes/catalog.js";
import { defaultCloudUrl } from "../cloud/url.js";
import type { ModelCatalog } from "../models/catalog.js";

export type SetupOptions = {
  recipe?: string;
  cloudUrl?: string;
};

export async function readRuntime(releaseFile: string) {
  releaseFile = resolve(releaseFile);
  const release = releaseSchema.parse(await readJson(releaseFile));
  if (
    !release.platforms.some(
      (platform) => platform === `${process.platform}-${process.arch}`,
    )
  )
    throw new InstallationError(
      "unsupported_platform",
      "This runtime release does not support this host platform. No fallback protection mode is available.",
    );
  return { release, releaseFile };
}

export async function setupContext(
  options: SetupOptions,
  retainedRelease?: string,
) {
  const catalog = await installationCatalog();
  let recipe = catalog.recipes.find((recipe) => recipe.id === options.recipe);
  if (!retainedRelease && !recipe) {
    if (!options.recipe)
      throw new InstallationError(
        "invalid_configuration",
        "Choose a recipe from clawscarf recipes or supply a recipe file.",
      );
    if (!options.recipe.endsWith(".json"))
      throw new InstallationError(
        "invalid_configuration",
        `Unknown recipe: ${options.recipe}`,
      );
    recipe = await readRecipe(resolve(options.recipe));
    validateRecipe(recipe, catalog);
    const selectedId = recipe.id;
    catalog.recipes = [
      recipe,
      ...catalog.recipes.filter((item) => item.id !== selectedId),
    ];
  }
  const file = retainedRelease ?? recipe?.runtime;
  if (!file)
    throw new InstallationError(
      "invalid_configuration",
      "The recipe must select a runtime release.",
    );
  return {
    ...catalog,
    ...(await readRuntime(file)),
    recipeId: recipe?.id,
    cloudUrl: options.cloudUrl ?? defaultCloudUrl,
  };
}
export type SetupContext = Awaited<ReturnType<typeof setupContext>>;

/** Both the menu and noninteractive configuration start from these exact defaults. */
export function recipeConfiguration(
  context: SetupContext,
  recipeId: string,
): InstallationDraft {
  const recipe = context.recipes.find((recipe) => recipe.id === recipeId);
  if (!recipe)
    throw new InstallationError(
      "invalid_configuration",
      `Unknown recipe: ${recipeId}`,
    );
  return {
    schemaVersion: 1,
    name: "team",
    releaseFile: context.releaseFile,
    stateDirectory: "./state",
    exposure: { mode: "local", applicationPort: 18800, widgetPort: 18802 },
    access: {
      mode: "hosted",
      administratorName: "Administrator",
      registrationFile: "./secrets/hosted-login.json",
      cloudUrl: context.cloudUrl,
    },
    resources: structuredClone(recipe.defaults.resources),
    browser: structuredClone(recipe.defaults.browser),
    publicWeb: recipe.defaults.publicWeb,
    connections: {
      mode: recipe.defaults.connections?.enabled ? "hosted" : "disabled",
      cloudUrl: context.cloudUrl,
      registrationFile: "./secrets/connections-registration.json",
    },
    packs: recipe.packs.map((pack) => ({
      directory: packDirectory(context, pack.id),
      members: [...pack.members],
    })),
    recipe: {
      id: recipe.id,
      version: recipe.version,
      release: context.release.version,
    },
  };
}

export function recipeModelFile(
  models: Recipe["models"],
  inputs: SetupInputs,
  catalog: ModelCatalog,
) {
  return inputs.set(
    "recipe-models.json",
    JSON.stringify(recipeModelRoutes(models, catalog), null, 2) + "\n",
  );
}

export function assertReleaseCapabilities(
  context: Pick<SetupContext, "release">,
  config: InstallationConfiguration,
) {
  if (
    config.browser.enabled &&
    (!context.release.images.browser || !context.release.images.relay)
  )
    throw new InstallationError(
      "invalid_configuration",
      "This release does not include browser images.",
    );
  if (config.models.mode === "litellm" && !context.release.images.models)
    throw new InstallationError(
      "invalid_configuration",
      "This release does not include LiteLLM.",
    );
}

function packDirectory(context: SetupContext, id: string) {
  const pack = context.packs.find((item) => item.id === id);
  if (!pack)
    throw new InstallationError("invalid_configuration", `Unknown pack: ${id}`);
  return pack.directory;
}
