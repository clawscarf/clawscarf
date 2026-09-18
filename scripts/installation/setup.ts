import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type InstallationConfiguration,
  type InstallationDraft,
} from "./configuration.js";
import { releaseSchema } from "../release/definition.js";
import { readJson } from "./files.js";
import { InstallationError } from "./errors.js";
import { SetupInputs } from "./save.js";
import { verifyReleasePacks } from "../release/packs.js";

export type SetupOptions = {
  release?: string;
  cloudUrl?: string;
};
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
        "No bundled release is available. Use a published operator bundle, or supply --release <file> for development. See deploy/deployment/installation.md for preparing release inputs.",
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
  const recipes = release.recipes;
  await verifyReleasePacks(release, releaseFile, recipes);
  return {
    release,
    releaseFile,
    recipes,
    ...(options.cloudUrl ? { cloudUrl: options.cloudUrl } : {}),
  };
}
export type SetupContext = Awaited<ReturnType<typeof setupContext>>;

/** Both the menu and noninteractive configuration start from these exact defaults. */
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
    access: {
      mode: "hosted",
      administratorName: "Administrator",
      registrationFile: "./secrets/hosted-login.json",
      cloudUrl: context.cloudUrl ?? context.release.cloudUrl,
    },
    resources: {
      runtime: { cpu: "4", memory: "4Gi" },
    },
    browser: { enabled: false },
    connections: {
      mode: recipe?.defaults.connections?.enabled ? "hosted" : "disabled",
      cloudUrl: context.cloudUrl ?? context.release.cloudUrl,
      registrationFile: "./secrets/connections-registration.json",
    },
    packs: (recipe?.packs ?? []).map((pack) => ({
      directory: resolve(dirname(context.releaseFile), "packs", pack.id),
      members: [...pack.members],
    })),
    ...(recipe
      ? {
          resources: recipe.defaults.resources,
          browser: recipe.defaults.browser,
        }
      : {}),
    ...(recipe
      ? { recipe: { id: recipe.id, release: context.release.version } }
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
