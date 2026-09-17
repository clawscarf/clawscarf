import { z } from "zod";
import {
  configurationSchema,
  gatewayRoutesSchema,
} from "../../../models/configuration.js";
import type { InstallationConfiguration } from "../../configuration.js";
import { InstallationError } from "../../errors.js";
import type { SetupInputs } from "../../save.js";
import { field } from "../inputs.js";
import type { InstallerPrompts } from "../prompts.js";
import { optionalCa } from "./certificates.js";

export async function collectExternalModels(
  ui: InstallerPrompts,
  inputs: SetupInputs,
  file: string,
  current?: InstallationConfiguration["models"],
): Promise<InstallationConfiguration["models"]> {
  const catalog = z
    .union([gatewayRoutesSchema, configurationSchema])
    .parse(await inputs.readJson(file));
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
  const previous =
    current?.mode === "external"
      ? configurationSchema.parse(
          await inputs.readJson(current.configurationFile),
        )
      : undefined;
  return {
    mode: "external",
    configurationFile: inputs.set(
      "external-models.json",
      JSON.stringify(config, null, 2),
    ),
    credentialFile:
      current?.mode === "external" &&
      previous?.mode === "external" &&
      previous.baseUrl === baseUrl
        ? current.credentialFile
        : "",
    ...(await optionalCa(
      ui,
      current?.mode === "external" ? current.caFile : undefined,
    )),
  };
}
