import { z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  installationSchema,
  externalLiteLlmSchema,
  bundledLiteLlmSchema,
  type InstallationConfiguration,
  type InstallationDraft,
} from "./configuration.js";
import { releaseSchema } from "../release/definition.js";
import { readJson } from "./files.js";
import { InstallationError } from "./errors.js";
import { SetupInputs } from "./save.js";
import { loadRecipes } from "./recipes/load.js";

export type SetupOptions = { release?: string; recipes?: string };
export async function setupContext(options: SetupOptions) {
  const releaseFile = resolve(
    options.release ??
      fileURLToPath(
        new URL("../../release/clawscarf-release.json", import.meta.url),
      ),
  );
  let json: unknown;
  try {
    json = await readJson(releaseFile);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new InstallationError(
        "unavailable",
        "No bundled release is available. Use a published operator bundle, or supply --release <file> for development. See deploy/local/installation.md for preparing release inputs.",
      );
    throw error;
  }
  const release = releaseSchema.parse(json);
  if (
    !release.platforms.some(
      (platform) => platform === `${process.platform}-${process.arch}`,
    )
  )
    throw new InstallationError(
      "unsupported_platform",
      "This release does not support this host platform. No fallback protection mode is available.",
    );
  const recipes = options.recipes
    ? await loadRecipes(resolve(options.recipes))
    : release.recipes;
  return { release, releaseFile, recipes };
}
export type SetupContext = Awaited<ReturnType<typeof setupContext>>;

/** Both the menu and noninteractive configure command start from these exact defaults. */
export function recipeConfiguration(
  context: SetupContext,
  recipeId: string,
): InstallationDraft {
  const recipe = context.recipes.find((recipe) => recipe.id === recipeId);
  if (recipeId !== "custom" && !recipe)
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
    access: { mode: "local", administratorName: "Administrator" },
    resources: {
      gateway: { cpu: "2", memory: "2Gi" },
      worker: { cpu: "2", memory: "2Gi" },
    },
    browser: { enabled: false },
    connections: { mode: "disabled" },
    packs: [],
    ...recipe?.defaults,
    ...(recipe
      ? { recipe: { id: recipe.id, release: context.release.version } }
      : {}),
  };
}

/** Section replacement, not recursive merging: switching modes discards obsolete fields. */
export const setupSettingsSchema = z
  .strictObject(installationSchema.shape)
  .omit({ schemaVersion: true, releaseFile: true, recipe: true })
  .partial()
  .extend({
    models: z
      .discriminatedUnion("mode", [
        externalLiteLlmSchema,
        bundledLiteLlmSchema.partial({
          configurationFile: true,
        }),
      ])
      .optional(),
  });
export function configureRecipe(
  context: SetupContext,
  recipeId: string,
  settings: unknown,
) {
  const config = installationSchema.parse(
    setupDraft(context, recipeId, settings),
  );
  assertReleaseCapabilities(context, config);
  return config;
}

/** Required runtime fields are validated only after interactive collection or CLI overrides. */
export function setupDraft(
  context: SetupContext,
  recipeId: string,
  settings: unknown,
  inputs?: SetupInputs,
): InstallationDraft {
  const overrides = setupSettingsSchema.parse(settings);
  const { models, ...rest } = overrides;
  const base = z
    .strictObject(installationSchema.shape)
    .omit({ models: true })
    .parse({ ...recipeConfiguration(context, recipeId), ...rest });
  if (models?.mode === "litellm" && !models.configurationFile) {
    const recipe = context.recipes.find((entry) => entry.id === recipeId);
    if (!recipe?.models || !inputs)
      throw new InstallationError(
        "invalid_configuration",
        "Supply model configuration, or select a recipe with model defaults.",
      );
    return {
      ...base,
      models: {
        ...models,
        configurationFile: recipeModelFile(recipe.models, inputs),
      },
    };
  }
  return {
    ...base,
    ...(models
      ? { models: installationSchema.shape.models.parse(models) }
      : {}),
  };
}
export function recipeModelFile(models: unknown, inputs: SetupInputs) {
  return inputs.set(
    "recipe-models.json",
    JSON.stringify(models, null, 2) + "\n",
  );
}

export function assertReleaseCapabilities(
  context: SetupContext,
  config: InstallationConfiguration,
) {
  if (config.browser.enabled && !context.release.images.browser)
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
