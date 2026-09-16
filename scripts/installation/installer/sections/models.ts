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
import { optionalCa } from "./certificates.js";

import type { SetupInputs } from "../../save.js";
import { secretInput } from "../secrets.js";

export async function collectModels(
  ui: InstallerPrompts,
  release: Release,
  current: InstallationConfiguration["models"],
  inputs: SetupInputs,
): Promise<InstallationConfiguration["models"]> {
  const mode = await ui.select(
    "Models",
    [
      { value: "back", label: "Back to installation" },
      { value: "disabled", label: "Configure later in OpenClaw" },
      { value: "external", label: "Use an existing model gateway" },
      ...(release.images.models
        ? [{ value: "litellm", label: "Run LiteLLM with this installation" }]
        : []),
    ],
    current.mode,
  );
  if (mode === "back") return current;
  if (mode === "disabled") return { mode };
  ui.note(
    "Use the model configuration format in the ClawScarf installation guide. Provider keys are kept outside the configuration document.",
    "Model configuration",
  );
  const configurationFile = await inputFile(
    ui,
    "Model configuration file",
    false,
    current.mode === "disabled" ? undefined : current.configurationFile,
  );
  if (mode === "external")
    return {
      mode,
      configurationFile,
      credentialFile: await secretInput(
        ui,
        inputs,
        "Scoped model gateway key",
        "model-key",
        current.mode === "external" ? current.credentialFile : undefined,
      ),
      ...(await optionalCa(
        ui,
        current.mode === "external" ? current.caFile : undefined,
      )),
    };
  if (mode !== "litellm" || !release.images.models)
    throw new InstallationError(
      "invalid_configuration",
      "This release does not include the selected model service.",
    );
  const routes = gatewayRoutesSchema.parse(await readJson(configurationFile));
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
  const variables = [
    ...new Set(
      checked.models
        .filter((model) => model.enabled)
        .map((model) => model.route?.apiKeyEnv),
    ),
  ];
  const credentialMode = await ui.select(
    "Provider credentials",
    [
      ...(current.mode === "litellm"
        ? [{ value: "keep", label: "Keep current credentials" }]
        : []),
      { value: "paste", label: "Enter provider keys (hidden)" },
      { value: "file", label: "Import private environment file" },
    ],
    current.mode === "litellm" ? "keep" : "paste",
  );
  let upstreamEnvironmentFile: string;
  if (credentialMode === "keep" && current.mode === "litellm")
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
