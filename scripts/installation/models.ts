import type { InstallationConfiguration } from "./configuration.js";
import type { Release } from "../release/definition.js";
import { gatewayRoutesSchema } from "../models/configuration.js";
import type { SetupInputs } from "./save.js";

/** One model update policy for menu selections and command-line overrides. */
export function selectModel(
  current: InstallationConfiguration["models"] | undefined,
  routes: ReturnType<typeof gatewayRoutesSchema.parse> | undefined,
  offer: NonNullable<Release["modelCatalog"]>[number],
  thinkingDefault: string | undefined,
  inputs: SetupInputs,
  retainModels = false,
): InstallationConfiguration["models"] {
  const id = offer.model.id;
  const selected = gatewayRoutesSchema.parse({
    models: [
      ...(routes?.models.filter(
        (model) =>
          model.id !== id && (retainModels || model.id !== routes.defaultModel),
      ) ?? []),
      { ...offer.model, enabled: true },
    ],
    defaultModel: id,
    ...(thinkingDefault ? { thinkingDefault } : {}),
  });
  const sameCredentials =
    current?.mode === "litellm" &&
    routes &&
    selected.models.every((model) =>
      routes.models.some(
        (before) =>
          before.route?.apiKeyEnv === model.route?.apiKeyEnv &&
          before.route?.model.split("/")[0] ===
            model.route?.model.split("/")[0],
      ),
    );
  return {
    mode: "litellm",
    configurationFile: inputs.set(
      "selected-models.json",
      JSON.stringify(selected, null, 2),
    ),
    upstreamEnvironmentFile: sameCredentials
      ? current.upstreamEnvironmentFile
      : "",
  };
}
