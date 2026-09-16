import { join } from "node:path";
import { localInput } from "../../local/configuration.js";
import { installationSchema } from "../configuration.js";
import { InstallationError } from "../errors.js";
import { installationMenu } from "./menu.js";
import { packRequirements } from "../requirements.js";
import { ZodError } from "zod";
import { InstallerCancelled } from "./prompts.js";
import { SetupInputs } from "../save.js";
import {
  assertReleaseCapabilities,
  recipeConfiguration,
  setupContext,
  type SetupOptions,
} from "../setup.js";
import type { InstallerPrompts } from "./prompts.js";
import { absolute, field, newDirectory } from "./inputs.js";
import { collectAccess } from "./sections/access.js";
import { collectConnections } from "./sections/connections.js";
import { collectModels } from "./sections/models.js";
import { collectPacks } from "./sections/packs.js";
import { collectResources } from "./sections/resources.js";

export type InstallOptions = SetupOptions & {
  directory?: string;
  recipe?: string;
};
export async function collectInstallation(
  ui: InstallerPrompts,
  options: InstallOptions,
) {
  const context = await setupContext(options);
  const recipeId =
    options.recipe ??
    (await ui.select("Starting point", [
      ...context.recipes.map((recipe) => ({
        value: recipe.id,
        label: recipe.name,
        hint:
          recipe.maturity === "example"
            ? "Example defaults; workflow not included"
            : recipe.description,
      })),
      { value: "custom", label: "Custom", hint: "Choose your own settings" },
    ]));
  const recipe = context.recipes.find((recipe) => recipe.id === recipeId);
  let config = recipeConfiguration(context, recipeId);
  let directory = absolute(
    options.directory ??
      (await ui.text("New installation directory", "./clawscarf-team")),
  );
  await newDirectory(directory);
  if (Buffer.byteLength(join(directory, "state/operator.sock")) > 100)
    throw new InstallationError(
      "invalid_configuration",
      "Choose a shorter installation directory (the control socket path must fit within 100 bytes).",
    );
  const inputs = new SetupInputs(directory);
  const initialConfiguration = JSON.stringify(config);
  if (recipe) ui.note(recipe.description, recipe.name);
  for (;;) {
    const customized = JSON.stringify(config) !== initialConfiguration;
    const pendingPacks = await packRequirements(config);
    const choice = await ui.select(
      `${recipe?.name ?? "Custom"}${customized ? " · customized" : ""} — configure installation`,
      installationMenu(
        config,
        directory,
        Boolean(context.release.images.browser),
        pendingPacks,
        recipe,
      ),
    );
    const previousInputs = new Map(inputs.files);
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
          config = { ...config, ...(await collectAccess(ui, config, inputs)) };
          break;
        case "models":
          config.models = await collectModels(
            ui,
            context.release,
            config.models,
            inputs,
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
    } catch (error) {
      if (error instanceof InstallerCancelled) throw error;
      inputs.files.clear();
      for (const [path, bytes] of previousInputs) inputs.files.set(path, bytes);
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
