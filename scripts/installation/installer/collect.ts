import { installationCatalog, readRecipe } from "../recipes/catalog.js";
import { defaultInstallationDirectory, installationName } from "../location.js";
import { isDeepStrictEqual, styleText } from "node:util";
import { resolve } from "node:path";
import {
  installationSchema,
  type InstallationDraft,
} from "../configuration.js";
import { InstallationError } from "../errors.js";
import { installationMenu } from "./menu.js";
import { packRequirements } from "../requirements.js";
import { InstallerCancelled, SectionCancelled } from "./prompts.js";
import { SetupInputs } from "../save.js";
import {
  assertReleaseCapabilities,
  recipeModelFile,
  setupContext,
} from "../setup.js";
import type { InstallerPrompts } from "./prompts.js";
import { absolute, newDirectory, inputErrorMessage } from "./inputs.js";
import { collectAccess, collectExposure } from "./sections/access.js";
import { collectConnections } from "./sections/connections.js";
import {
  collectModels,
  collectModelCredentials,
  collectAiService,
} from "./sections/models.js";
import { collectPacks, collectPackInputs } from "./sections/packs.js";
import { selectedDraft, type ConfigureOptions } from "../options.js";
import { installationSummary, modelSummary } from "./summary.js";
import { secretInput } from "./secrets.js";
import { inputFile } from "./inputs.js";
import { collectResources } from "./sections/resources.js";

export type InstallOptions = ConfigureOptions & { existing?: boolean };
interface InstallationDraftState {
  directory: string;
  config: InstallationDraft;
  inputs: SetupInputs;
}
export async function collectInstallation(
  ui: InstallerPrompts,
  options: InstallOptions,
  retained?: InstallationDraftState,
) {
  const catalog = await installationCatalog();
  const customRecipe = options.recipe?.endsWith(".json")
    ? await readRecipe(resolve(options.recipe))
    : undefined;
  if (customRecipe)
    catalog.recipes = [
      customRecipe,
      ...catalog.recipes.filter((recipe) => recipe.id !== customRecipe.id),
    ];
  let recipeId = retained
    ? (retained.config.recipe?.id ?? "custom")
    : options.recipe;
  let chooseRecipe = recipeId === undefined;
  ui.note("Esc: back · Ctrl+C: exit", "Navigation");
  startingPoint: for (;;) {
    let directory: string;
    try {
      if (chooseRecipe) {
        try {
          recipeId = await ui.select(
            "Starting point",
            [
              ...catalog.recipes.map((recipe) => ({
                value:
                  recipe.id === customRecipe?.id
                    ? (options.recipe ?? recipe.id)
                    : recipe.id,
                label: recipe.name,
                hint:
                  recipe.maturity === "example"
                    ? "Example defaults; workflow not included"
                    : recipe.description,
              })),
            ],
            recipeId,
          );
        } catch (error) {
          if (error instanceof SectionCancelled) throw new InstallerCancelled();
          throw error;
        }
      }
      directory = absolute(
        retained?.directory ??
          options.directory ??
          defaultInstallationDirectory,
      );
    } catch (error) {
      if (!(error instanceof SectionCancelled)) throw error;
      chooseRecipe = true;
      continue;
    }
    if (!options.existing) await newDirectory(directory);
    const context = await setupContext(
      {
        ...options,
        ...(retained?.config.models?.mode === "litellm" &&
        retained.config.models.cloud
          ? { cloudUrl: retained.config.models.cloud.url }
          : retained?.config.access.mode === "hosted"
            ? { cloudUrl: retained.config.access.cloudUrl }
            : {}),
        ...(recipeId ? { recipe: recipeId } : {}),
      },
      options.existing ? retained?.config.releaseFile : undefined,
    );
    const recipe = context.recipes.find(
      (recipe) => recipe.id === context.recipeId,
    );
    const selectedId = context.recipeId ?? recipeId;
    if (selectedId === undefined)
      throw new InstallationError(
        "invalid_configuration",
        "Select a starting point.",
      );
    if (retained && (retained.config.recipe?.id ?? "custom") !== selectedId)
      retained = undefined;
    const inputs = retained?.inputs ?? new SetupInputs(directory);
    let config =
      retained?.config ??
      (await selectedDraft(context, selectedId, options, inputs));
    if (!options.existing && config.access.mode === "hosted")
      config.access.registrationFile = resolve(
        directory,
        "secrets/hosted-login.json",
      );
    const presetFile =
      !config.models && recipe?.models
        ? recipeModelFile(
            recipe.models,
            inputs,
            context.modelCatalog,
            context.cloudUrl,
          )
        : undefined;
    if (!config.models && presetFile)
      config.models = {
        mode: "litellm",
        configurationFile: presetFile,
        upstreamEnvironmentFile: "",
      };

    const initialConfiguration = JSON.stringify(config);
    let aiChosen = Boolean(
      options.existing ||
      options.aiService ||
      options.provider ||
      options.llmKeyFile ||
      options.providerEnvFile ||
      options.modelCatalog,
    );
    const initialCloudAi = Boolean(
      config.models?.mode === "litellm" && config.models.cloud,
    );
    if (!options.existing && initialCloudAi)
      ui.note(
        [
          ...(recipe ? [recipe.description, ""] : []),
          "One account for team login, AI and connections to your business apps.",
          "Choose prepaid Cloud AI or use your own provider API key.",
          "",
          "Team login is free. AI uses prepaid credits.",
          "Connections is optional, with paid usage beyond your allowance.",
          "",
          "Have your own login provider or API key? Choose those below.",
        ].join("\n"),
        styleText(["bold", "cyan"], "Get started with ClawScarf Cloud"),
      );
    else if (recipe) ui.note(recipe.description, recipe.name);
    for (;;) {
      const customized = JSON.stringify(config) !== initialConfiguration;
      const pendingPacks = await packRequirements(config);
      let choice: string;
      try {
        choice = await ui.select(
          options.existing
            ? `${config.name} — settings`
            : `${recipe?.name ?? "Custom"}${customized ? " · customized" : ""} — configure installation`,
          installationMenu(
            config,
            directory,
            Boolean(context.release.images.browser),
            pendingPacks,
            await modelSummary(config, inputs),
            options.existing,
          ),
          "review",
        );
      } catch (error) {
        if (!(error instanceof SectionCancelled)) throw error;
        if (options.existing) throw new InstallerCancelled();
        retained = { directory, config, inputs };
        chooseRecipe = true;
        continue startingPoint;
      }
      const previousInputs = new Map(inputs.files);
      const previousConfig = structuredClone(config);
      const previousDirectory = directory;
      const previousAiChosen = aiChosen;
      try {
        switch (choice) {
          case "location": {
            const next = absolute(
              await ui.text("New installation directory", directory),
            );
            await newDirectory(next);
            directory = next;
            config.name = installationName(next);
            break;
          }
          case "exposure":
            config.exposure = await collectExposure(ui, config);
            break;
          case "access":
            config = {
              ...config,
              ...(await collectAccess(ui, config, context.cloudUrl)),
            };
            break;
          case "models":
            config.models = await collectModels(
              ui,
              context.modelCatalog,
              config.models,
              inputs,
              presetFile,
              options.existing &&
                initialCloudAi ===
                  Boolean(
                    config.models?.mode === "litellm" && config.models.cloud,
                  ),
            );
            aiChosen = true;
            break;
          case "model-credentials":
            if (!config.models)
              throw new InstallationError(
                "invalid_configuration",
                "Select a model first.",
              );
            config.models = await collectModelCredentials(
              ui,
              config.models.mode === "litellm"
                ? { ...config.models, upstreamEnvironmentFile: "" }
                : { ...config.models, credentialFile: "" },
              inputs,
            );
            break;
          case "connections":
            config.connections = await collectConnections(
              ui,
              config.connections,
            );
            break;
          case "resources":
            config.resources = await collectResources(ui, config.resources);
            break;
          case "public-web":
            config.publicWeb =
              (await ui.select(
                "Public web access",
                [
                  {
                    value: "on",
                    label: "On",
                    hint: "Public HTTP(S); agents can send team data to public services",
                  },
                  {
                    value: "off",
                    label: "Off",
                    hint: "Only configured services and explicit policies",
                  },
                ],
                config.publicWeb ? "on" : "off",
              )) === "on";
            break;
          case "browser":
            ui.note(
              "Explicit browser node use works. Ordinary model-selected browsing is not qualified because of an upstream routing issue.",
              "Experimental browser",
            );
            config.browser.enabled =
              (await ui.select(
                "Browser",
                [
                  { value: "off", label: "Off" },
                  { value: "on", label: "On (experimental)" },
                ],
                config.browser.enabled ? "on" : "off",
              )) === "on";
            break;
          case "packs": {
            const selection = await collectPacks(
              ui,
              config.models,
              config.connections,
              config,
              context.packs,
            );
            if (!options.existing) delete config.packOperator;
            config = { ...config, ...selection };
            break;
          }
          case "review": {
            if (!config.models)
              config.models = await collectModels(
                ui,
                context.modelCatalog,
                undefined,
                inputs,
                presetFile,
                options.existing,
              );
            if (!aiChosen) {
              config.models = await collectAiService(
                ui,
                context.modelCatalog,
                config.models,
                inputs,
              );
              aiChosen = true;
            }
            ui.note(
              await installationSummary(config, inputs),
              "Selected settings",
            );
            config.models = await collectModelCredentials(
              ui,
              config.models,
              inputs,
            );
            if (config.exposure.mode === "https" && !config.exposure.keyFile)
              config.exposure.keyFile = await inputFile(
                ui,
                "TLS private key file",
                true,
              );
            if (
              config.access.mode === "oidc" &&
              !config.access.clientSecretFile
            )
              config.access.clientSecretFile = await secretInput(
                ui,
                inputs,
                "OIDC client secret",
                "oidc-client-secret",
              );
            config = { ...config, ...(await collectPackInputs(ui, config)) };
            if (config.access.mode === "hosted" && !options.existing) {
              config.access.registrationFile = resolve(
                directory,
                "secrets/hosted-login.json",
              );
            }
            if (!options.existing) {
              config.connections.registrationFile = resolve(
                directory,
                "secrets/connections-registration.json",
              );
            }
            const parsed = installationSchema.parse(config);
            assertReleaseCapabilities(context, parsed);
            const issues = await packRequirements(parsed);
            if (issues.length) {
              ui.note(issues.join("\n"), "Packs need attention");
              continue;
            }
            return { directory, config: parsed, inputs };
          }
          default:
            throw new InstallationError(
              "invalid_configuration",
              "Select an installation section.",
            );
        }
        if (
          (!isDeepStrictEqual(config, previousConfig) ||
            directory !== previousDirectory ||
            !isDeepStrictEqual(inputs.files, previousInputs)) &&
          !(await ui.confirm("Save section changes?"))
        )
          throw new SectionCancelled();
      } catch (error) {
        if (error instanceof InstallerCancelled) throw error;
        config = previousConfig;
        directory = previousDirectory;
        aiChosen = previousAiChosen;
        inputs.files.clear();
        for (const [path, bytes] of previousInputs)
          inputs.files.set(path, bytes);
        if (error instanceof SectionCancelled) continue;
        const message = inputErrorMessage(error);
        if (!message) throw error;
        ui.note(message, "Section needs attention");
      }
    }
  }
}
