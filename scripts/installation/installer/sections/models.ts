import type { InstallationConfiguration } from "../../configuration.js";
import type { Release } from "../../../release/definition.js";
import type { InstallerPrompts } from "../prompts.js";
import { readJson } from "../../files.js";
import {
  gatewayRoutesSchema,
  configurationSchema,
} from "../../../models/configuration.js";
import { inputFile } from "../inputs.js";
import { InstallationError } from "../../errors.js";
import { collectExternalModels } from "./external-models.js";

import type { SetupInputs } from "../../save.js";

export async function collectModels(
  ui: InstallerPrompts,
  release: Release,
  current: InstallationConfiguration["models"] | undefined,
  inputs: SetupInputs,
  presetFile?: string,
  required = false,
): Promise<InstallationConfiguration["models"]> {
  const mode = required
    ? (current?.mode ?? "litellm")
    : await ui.select(
        "Models",
        [
          { value: "external", label: "Use existing LiteLLM (advanced)" },
          ...(release.images.models
            ? [{ value: "litellm", label: "Bundled LiteLLM" }]
            : []),
        ],
        current?.mode ?? "litellm",
      );
  const availableFile =
    current?.mode === mode ? current.configurationFile : presetFile;
  const keepCatalog =
    availableFile &&
    (required ||
      (await ui.select(
        "Model catalog",
        [
          { value: "keep", label: "Keep model catalog" },
          { value: "file", label: "Import model catalog" },
        ],
        "keep",
      )) === "keep");
  let configurationFile =
    keepCatalog && availableFile
      ? availableFile
      : await inputFile(
          ui,
          mode === "external"
            ? "Existing LiteLLM model configuration file"
            : "Model configuration file",
          false,
        );
  if (mode === "external")
    return collectExternalModels(ui, inputs, configurationFile, current);
  if (mode !== "litellm" || !release.images.models)
    throw new InstallationError(
      "invalid_configuration",
      "This release does not include the selected model service.",
    );
  const staged = inputs.files.get(configurationFile);
  const source: unknown = staged
    ? JSON.parse(staged.toString("utf8"))
    : await readJson(configurationFile);
  const routes = gatewayRoutesSchema.parse(source);
  const checked = configurationSchema.parse({
    ...routes,
    mode: "litellm",
    baseUrl: "https://host.docker.internal/v1",
  });
  if (checked.mode !== "litellm")
    throw new InstallationError(
      "invalid_configuration",
      "Select LiteLLM routes.",
    );
  if (!required) {
    routes.defaultModel = await ui.select(
      "Default model",
      routes.models
        .filter((model) => model.enabled)
        .map((model) => ({ value: model.id, label: model.name })),
      routes.defaultModel,
    );
    configurationFile = inputs.set(
      "selected-models.json",
      JSON.stringify(routes, null, 2),
    );
  }
  const variables = [
    ...new Set(
      checked.models
        .filter((model) => model.enabled)
        .map((model) => model.route?.apiKeyEnv),
    ),
  ];
  const credentialMode = required
    ? "paste"
    : await ui.select(
        "Provider credentials",
        [
          ...(current?.mode === "litellm"
            ? [{ value: "keep", label: "Keep current credentials" }]
            : []),
          { value: "paste", label: "Enter provider keys (hidden)" },
          { value: "file", label: "Import private environment file" },
        ],
        current?.mode === "litellm" ? "keep" : "paste",
      );
  let upstreamEnvironmentFile: string;
  if (credentialMode === "keep" && current?.mode === "litellm")
    upstreamEnvironmentFile = current.upstreamEnvironmentFile;
  else if (credentialMode === "file")
    upstreamEnvironmentFile = await inputFile(
      ui,
      "Provider credentials file (.env)",
      true,
    );
  else {
    const values: string[] = [];
    for (const variable of variables) {
      if (!variable)
        throw new InstallationError(
          "invalid_configuration",
          "Every enabled route requires a credential variable.",
        );
      const key = await ui.password(`${variable} key`);
      if (!key.trim() || /[\r\n'"`]/.test(key))
        throw new InstallationError(
          "invalid_configuration",
          "Use a nonempty single-line provider key without quote characters, or import its environment file.",
        );
      values.push(`${variable}='${key}'`);
    }
    upstreamEnvironmentFile = inputs.set(
      "models.env",
      values.join("\n") + "\n",
    );
  }
  return { mode, configurationFile, upstreamEnvironmentFile };
}
