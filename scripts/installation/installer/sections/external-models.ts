import { z } from "zod";
import {
  configurationSchema,
  gatewayRoutesSchema,
} from "../../../models/configuration.js";
import type { InstallationConfiguration } from "../../configuration.js";
import { InstallationError } from "../../errors.js";
import { readJson } from "../../files.js";
import type { SetupInputs } from "../../save.js";
import { field } from "../inputs.js";
import type { InstallerPrompts } from "../prompts.js";
import { secretInput } from "../secrets.js";
import { optionalCa } from "./certificates.js";

export async function collectExternalModels(
  ui: InstallerPrompts,
  inputs: SetupInputs,
  file: string,
  current?: InstallationConfiguration["models"],
): Promise<InstallationConfiguration["models"]> {
  const staged = inputs.files.get(file);
  const source: unknown = staged
    ? JSON.parse(staged.toString("utf8"))
    : await readJson(file);
  const catalog = z
    .union([gatewayRoutesSchema, configurationSchema])
    .parse(source);
  if ("mode" in catalog && catalog.mode === "disabled")
    throw new InstallationError(
      "invalid_configuration",
      "LiteLLM requires an enabled model catalog.",
    );
  const baseUrl = await field(
    ui,
    "LiteLLM API URL (ending in /v1)",
    z.url(),
    "baseUrl" in catalog ? catalog.baseUrl : undefined,
  );
  const config = configurationSchema.parse({
    mode: "external",
    baseUrl,
    models: catalog.models,
    defaultModel: catalog.defaultModel,
    ...(catalog.thinkingDefault
      ? { thinkingDefault: catalog.thinkingDefault }
      : {}),
  });
  return {
    mode: "external",
    configurationFile: inputs.set(
      "external-models.json",
      JSON.stringify(config, null, 2),
    ),
    credentialFile: await secretInput(
      ui,
      inputs,
      "Scoped model gateway key",
      "model-key",
      current?.mode === "external" ? current.credentialFile : undefined,
    ),
    ...(await optionalCa(
      ui,
      current?.mode === "external" ? current.caFile : undefined,
    )),
  };
}
