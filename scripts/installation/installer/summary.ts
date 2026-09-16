import { z } from "zod";
import { gatewayRoutesSchema } from "../../models/configuration.js";
import { readJson } from "../files.js";
import type { SetupInputs } from "../save.js";
import type { InstallationDraft } from "../configuration.js";

export async function installationSummary(
  config: InstallationDraft,
  inputs?: SetupInputs,
) {
  let model = "Provider credentials needed";
  if (config.models) {
    const placement =
      config.models.mode === "litellm" ? "Bundled LiteLLM" : "Existing LiteLLM";
    try {
      const staged = inputs?.files.get(config.models.configurationFile);
      const value: unknown = staged
        ? JSON.parse(staged.toString("utf8"))
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
      model = `${placement} · ${selected?.name ?? "No default"}${catalog.thinkingDefault ? ` · ${catalog.thinkingDefault}` : ""}`;
    } catch {
      model = `${placement} · Check model catalog`;
    }
  }

  const origin =
    config.exposure.mode === "local"
      ? `http://127.0.0.1:${String(config.exposure.applicationPort)}`
      : config.exposure.applicationOrigin;
  return [
    `${config.name} — ${origin}`,
    `Administrator: ${config.access.administratorName} · ${config.access.mode === "local" ? "Local login" : "Company login"}`,
    `Models: ${model}`,
    `Connections: ${config.connections.mode === "disabled" ? "Off" : config.connections.mode}`,
    `Browser: ${config.browser.enabled ? "Experimental" : "Off"} · Packs: ${config.packs.flatMap((pack) => pack.members).join(", ") || "None"}`,
  ].join("\n");
}
