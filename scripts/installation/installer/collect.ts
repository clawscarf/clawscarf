import { isDeepStrictEqual } from "node:util";
import { dirname, resolve, join } from "node:path";
import { localInput } from "../../local/configuration.js";
import {
  installationSchema,
  type InstallationDraft,
} from "../configuration.js";
import { InstallationError } from "../errors.js";
import { installationMenu } from "./menu.js";
import { packRequirements } from "../requirements.js";
import { ZodError } from "zod";
import { InstallerCancelled, SectionCancelled } from "./prompts.js";
import { SetupInputs } from "../save.js";
import {
  assertReleaseCapabilities,
  setupDraft,
  recipeModelFile,
  setupContext,
  type SetupOptions,
} from "../setup.js";
import type { InstallerPrompts } from "./prompts.js";
import { absolute, field, newDirectory } from "./inputs.js";
import { collectAccess } from "./sections/access.js";
import { collectConnections } from "./sections/connections.js";
import { collectModels } from "./sections/models.js";
import { collectPacks } from "./sections/packs.js";
import { readJson } from "../files.js";
import { resolveConfigurationInputs } from "../configure.js";
import { installationSummary } from "./summary.js";
import { collectResources } from "./sections/resources.js";

export type InstallOptions = SetupOptions & {
  directory?: string;
  recipe?: string;
  settings?: string;
};
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
  const context = await setupContext(options);
  let recipeId = retained
    ? (retained.config.recipe?.id ?? "custom")
    : options.recipe;
  let chooseRecipe = recipeId === undefined;
  ui.note("Esc: back · Ctrl+C: exit", "Navigation");
  startingPoint: for (;;) {
    let directory: string;
    try {
      if (chooseRecipe)
        recipeId = await ui.select(
          "Starting point",
          [
            ...context.recipes.map((recipe) => ({
              value: recipe.id,
              label: recipe.name,
              hint:
                recipe.maturity === "example"
                  ? "Example defaults; workflow not included"
                  : recipe.description,
            })),
            {
              value: "custom",
              label: "Custom",
              hint: "Choose your own settings",
            },
          ],
          recipeId,
        );
      directory = absolute(
        retained?.directory ??
          options.directory ??
          (await ui.text("New installation directory", "./clawscarf-team")),
      );
    } catch (error) {
      if (!(error instanceof SectionCancelled)) throw error;
      chooseRecipe = true;
      continue;
    }
    await newDirectory(directory);
    if (Buffer.byteLength(join(directory, "state/operator.sock")) > 100)
      throw new InstallationError(
        "invalid_configuration",
        "Choose a shorter installation directory (the control socket path must fit within 100 bytes).",
      );
    const recipe = context.recipes.find((recipe) => recipe.id === recipeId);
    if (recipeId === undefined)
      throw new InstallationError(
        "invalid_configuration",
        "Select a starting point.",
      );
    if (retained && (retained.config.recipe?.id ?? "custom") !== recipeId)
      retained = undefined;
    const inputs = retained?.inputs ?? new SetupInputs(directory);
    const settings = options.settings ? await readJson(options.settings) : {};
    let config =
      retained?.config ??
      resolveConfigurationInputs(
        setupDraft(context, recipeId, settings, inputs),
        options.settings ? dirname(resolve(options.settings)) : process.cwd(),
      );
    const initialConfiguration = JSON.stringify(config);
    const presetFile = recipe?.models
      ? recipeModelFile(recipe.models, inputs)
      : undefined;
    let customize = !retained && recipeId === "custom";
    let askRequiredModels = !customize && !config.models;

    if (recipe) ui.note(recipe.description, recipe.name);
    for (;;) {
      const customized = JSON.stringify(config) !== initialConfiguration;
      const pendingPacks = await packRequirements(config);
      let choice: string;
      try {
        if (askRequiredModels) {
          askRequiredModels = false;
          choice = "required-models";
        } else if (!customize) {
          ui.note(
            await installationSummary(config, inputs),
            recipe?.name ?? "Installation",
          );
          choice = await ui.select(
            "Review installation",
            [
              {
                value: config.models ? "review" : "required-models",
                label: config.models ? "Continue" : "Set up models",
              },
              { value: "customize", label: "Customize" },
            ],
            config.models ? "review" : "required-models",
          );
          if (choice === "customize") {
            customize = true;
            continue;
          }
        } else {
          choice = await ui.select(
            `${recipe?.name ?? "Custom"}${customized ? " · customized" : ""} — configure installation`,
            installationMenu(
              config,
              directory,
              Boolean(context.release.images.browser),
              pendingPacks,
            ),
          );
        }
      } catch (error) {
        if (!(error instanceof SectionCancelled)) throw error;
        if (customize) {
          customize = false;
          continue;
        }
        retained = { directory, config, inputs };
        chooseRecipe = true;
        continue startingPoint;
      }
      const previousInputs = new Map(inputs.files);
      const previousConfig = structuredClone(config);
      const previousDirectory = directory;
      try {
        switch (choice) {
          case "location": {
            const next = absolute(
              await ui.text("New installation directory", directory),
            );
            await newDirectory(next);
            if (Buffer.byteLength(join(next, "state/operator.sock")) > 100)
              throw new InstallationError(
                "invalid_configuration",
                "Choose a shorter directory for the control socket.",
              );
            directory = next;
            break;
          }
          case "identity": {
            const name = await field(
              ui,
              "Installation name",
              localInput.shape.name,
              config.name,
            );
            const administratorName = await field(
              ui,
              "Administrator display name",
              localInput.shape.administratorName,
              config.access.administratorName,
            );
            config = {
              ...config,
              name,
              access: { ...config.access, administratorName },
            };
            break;
          }
          case "access":
            config = {
              ...config,
              ...(await collectAccess(ui, config, inputs)),
            };
            break;
          case "required-models":
          case "models":
            config.models = await collectModels(
              ui,
              context.release,
              config.models,
              inputs,
              presetFile,
              choice === "required-models",
            );
            break;
          case "connections":
            config.connections = await collectConnections(
              ui,
              config.connections,
              inputs,
            );
            break;
          case "resources":
            config.resources = await collectResources(ui, config.resources);
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
            );
            delete config.packOperator;
            config = { ...config, ...selection };
            break;
          }
          case "review": {
            if (customize) {
              customize = false;
              continue;
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
          choice !== "required-models" &&
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
        inputs.files.clear();
        for (const [path, bytes] of previousInputs)
          inputs.files.set(path, bytes);
        if (error instanceof SectionCancelled) continue;
        ui.note(
          error instanceof InstallationError
            ? error.message
            : error instanceof ZodError
              ? "Check the selected configuration fields and their supported values."
              : "Could not read the selected inputs. Check their paths, contents and permissions.",
          "Section needs attention",
        );
      }
    }
  }
}
