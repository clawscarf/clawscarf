import { inputErrorMessage } from "./inputs.js";
import { providerLabel } from "./sections/models.js";
import { z } from "zod";
import { gatewayRoutesSchema } from "../../models/configuration.js";
import { readJson } from "../files.js";
import type { SetupInputs } from "../save.js";
import type { InstallationDraft } from "../configuration.js";

export async function modelSummary(
  config: InstallationDraft,
  inputs?: SetupInputs,
) {
  let model = "Provider credentials needed";
  if (config.models) {
    const placement =
      config.models.mode === "litellm" ? "Provider" : "Existing model gateway";
    try {
      const value = inputs
        ? await inputs.readJson(config.models.configurationFile)
        : await readJson(config.models.configurationFile);
      const catalog = z
        .object({
          models: gatewayRoutesSchema.shape.models,
          defaultModel: z.string().nullable(),
          thinkingDefault: gatewayRoutesSchema.shape.thinkingDefault,
        })
        .parse(value);
      const selected = catalog.models.find(
        (entry) => entry.id === catalog.defaultModel,
      );
      model = `${selected?.route ? providerLabel(selected.route) : placement} · ${selected?.name ?? "No default"}${catalog.thinkingDefault ? ` · ${catalog.thinkingDefault}` : ""}`;
    } catch (error) {
      if (!inputErrorMessage(error)) throw error;
      model = `${placement} · Check model catalog`;
    }
  }

  return model;
}
export async function installationSummary(
  config: InstallationDraft,
  inputs?: SetupInputs,
) {
  const model = await modelSummary(config, inputs);
  const origin =
    config.exposure.mode === "local"
      ? `http://127.0.0.1:${String(config.exposure.applicationPort)}`
      : config.exposure.applicationOrigin;
  return [
    `${config.name} — ${origin}`,
    `Administrator: ${config.access.administratorName} · ${config.access.mode === "hosted" ? "ClawScarf login" : "Custom OIDC"}`,
    `Models: ${model}`,
    `Connections: ${config.connections.mode === "disabled" ? "Off" : "On"}`,
    `Public web: ${config.publicWeb ? "On" : "Off"} (private destinations blocked)`,
    `Browser: ${config.browser.enabled ? "Experimental" : "Off"} · Packs: ${config.packs.flatMap((pack) => pack.members).join(", ") || "None"}`,
  ].join("\n");
}
