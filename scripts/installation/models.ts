import type { Recipe } from "./recipes/definition.js";
import { InstallationError } from "./errors.js";
import type { InstallationConfiguration } from "./configuration.js";
import type { ModelCatalog } from "../models/catalog.js";
import { gatewayRoutesSchema } from "../models/configuration.js";
import type { SetupInputs } from "./save.js";

/** One model update policy for menu selections and command-line overrides. */
export function selectModel(
  current: InstallationConfiguration["models"] | undefined,
  routes: ReturnType<typeof gatewayRoutesSchema.parse> | undefined,
  offer: ModelCatalog[number],
  thinkingDefault: string | undefined,
  inputs: SetupInputs,
  retainModels = false,
): InstallationConfiguration["models"] {
  const id = offer.model.id;
  const cloud =
    offer.provider === "ClawScarf Cloud"
      ? (current?.mode === "litellm" && current.cloud) || {
          url: new URL(offer.model.route.apiBase ?? "").origin,
          registrationFile: "./secrets/ai-registration.json",
        }
      : undefined;
  const sameService =
    Boolean(cloud) === Boolean(current?.mode === "litellm" && current.cloud);
  const selected = gatewayRoutesSchema.parse({
    models: [
      ...(sameService
        ? (routes?.models.filter(
            (model) =>
              model.id !== id &&
              (retainModels || model.id !== routes.defaultModel),
          ) ?? [])
        : []),
      { ...offer.model, enabled: true },
    ],
    defaultModel: id,
    ...(thinkingDefault ? { thinkingDefault } : {}),
  });
  const sameCredentials =
    sameService &&
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
      : cloud
        ? "./secrets/cloud-ai.env"
        : "",
    ...(cloud ? { cloud } : {}),
  };
}

export async function selectAiService(
  service: "cloud" | "provider",
  current: InstallationConfiguration["models"],
  catalog: ModelCatalog,
  inputs: SetupInputs,
) {
  if (
    current.mode === "litellm" &&
    Boolean(current.cloud) === (service === "cloud")
  )
    return current;
  const routes = gatewayRoutesSchema.parse(
    await inputs.readJson(current.configurationFile),
  );
  const candidates = catalog.filter(
    (offer) => (offer.provider === "ClawScarf Cloud") === (service === "cloud"),
  );
  const name = routes.defaultModel.split("/").at(-1);
  const offer =
    candidates.find(
      (candidate) => candidate.model.id.split("/").at(-1) === name,
    ) ?? candidates[0];
  if (!offer)
    throw new InstallationError(
      "invalid_configuration",
      "No models are available for this AI service.",
    );
  return selectModel(current, routes, offer, routes.thinkingDefault, inputs);
}

/** Recipes select an offering; model catalog metadata has one owner. */
export function recipeModelRoutes(
  choice: Recipe["models"],
  catalog: ModelCatalog,
) {
  const matches = catalog.filter(
    (item) =>
      item.model.enabled &&
      item.model.id === choice.model &&
      (choice.service === "cloud"
        ? item.provider === "ClawScarf Cloud"
        : item.provider !== "ClawScarf Cloud" &&
          item.model.route.model.split("/")[0] === choice.provider),
  );
  const offer = matches[0];
  if (
    !offer ||
    matches.length !== 1 ||
    (choice.reasoning && !offer.reasoningLevels.includes(choice.reasoning))
  )
    throw new InstallationError(
      "invalid_configuration",
      "Recipe model, provider and reasoning must select one enabled offering in the model catalog.",
    );
  return gatewayRoutesSchema.parse({
    models: [offer.model],
    defaultModel: choice.model,
    ...(choice.reasoning ? { thinkingDefault: choice.reasoning } : {}),
  });
}
