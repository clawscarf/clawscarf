import { selectModel } from "../../models.js";
import type { InstallationConfiguration } from "../../configuration.js";
import { type ModelCatalog } from "../../../models/catalog.js";
import type { InstallerPrompts } from "../prompts.js";
import {
  gatewayRoutesSchema,
  configurationSchema,
} from "../../../models/configuration.js";
import { secretInput } from "../secrets.js";
import { InstallationError } from "../../errors.js";
import type { SetupInputs } from "../../save.js";

export async function modelRoutes(file: string, inputs: SetupInputs) {
  return gatewayRoutesSchema.parse(await inputs.readJson(file));
}
export function providerLabel(route: { model: string }) {
  const name = route.model.split("/")[0] ?? "Provider";
  return (
    (
      {
        openrouter: "OpenRouter",
        openai: "OpenAI",
        anthropic: "Anthropic",
        gemini: "Google",
      } as Record<string, string>
    )[name] ?? name
  );
}

/** Settings only. Credentials are collected after the complete installation review. */
export async function collectModels(
  ui: InstallerPrompts,
  offers: ModelCatalog,
  current: InstallationConfiguration["models"] | undefined,
  inputs: SetupInputs,
  presetFile?: string,
  retainModels = false,
): Promise<InstallationConfiguration["models"]> {
  if (current?.mode === "external") {
    const catalog = configurationSchema.parse(
      await inputs.readJson(current.configurationFile),
    );
    if (catalog.mode !== "external")
      throw new InstallationError(
        "invalid_configuration",
        "Supply the existing gateway's model catalog with --model-catalog.",
      );
    const defaultModel = await ui.select(
      "Default model",
      catalog.models
        .filter((model) => model.enabled)
        .map((model) => ({ value: model.id, label: model.name })),
      catalog.defaultModel ?? undefined,
    );
    const model = catalog.models.find((model) => model.id === defaultModel);
    const thinkingDefault = model?.reasoning
      ? await ui.select(
          "Reasoning",
          ["low", "medium", "high"].map((value) => ({ value, label: value })),
          catalog.thinkingDefault ?? "medium",
        )
      : undefined;
    const { thinkingDefault: _previous, ...base } = catalog;
    return {
      ...current,
      configurationFile: inputs.set(
        "external-models.json",
        JSON.stringify({
          ...base,
          defaultModel,
          ...(thinkingDefault ? { thinkingDefault } : {}),
        }),
      ),
    };
  }
  const file = current?.configurationFile ?? presetFile;
  const routes = file ? await modelRoutes(file, inputs) : undefined;
  const available = [...offers];
  for (const model of routes?.models ?? [])
    if (
      model.route &&
      !available.some((offer) => offer.model.route.model === model.route?.model)
    )
      available.push({
        provider:
          current?.mode === "litellm" && current.cloud
            ? "ClawScarf Cloud"
            : providerLabel(model.route),
        model: { ...model, route: model.route },
        reasoningLevels: model.reasoning ? ["low", "medium", "high"] : [],
      });
  const choices = new Map<string, ModelCatalog[number]>();
  for (const offer of available)
    if (!choices.has(offer.model.id)) choices.set(offer.model.id, offer);
  if (!choices.size)
    throw new InstallationError(
      "invalid_configuration",
      "No supported models are available.",
    );
  const previous = routes?.models.find(
    (model) => model.id === routes.defaultModel,
  );
  const identity = previous?.id;
  const selected = await ui.select(
    "Default model",
    [...choices.values()].map((offer) => ({
      value: offer.model.id,
      label: offer.model.name,
    })),
    identity ? choices.get(identity)?.model.id : undefined,
  );
  const selectedOffer = [...choices.values()].find(
    (offer) => offer.model.id === selected,
  );
  if (!selectedOffer)
    throw new InstallationError(
      "invalid_configuration",
      "Choose a supported model.",
    );
  const offer = await chooseModelService(
    ui,
    available.filter((item) => item.model.id === selectedOffer.model.id),
    current,
    previous?.route?.model,
  );
  const thinkingDefault = offer.reasoningLevels.length
    ? await ui.select(
        "Reasoning",
        offer.reasoningLevels.map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        })),
        routes?.thinkingDefault &&
          offer.reasoningLevels.includes(routes.thinkingDefault)
          ? routes.thinkingDefault
          : offer.reasoningLevels.includes("medium")
            ? "medium"
            : offer.reasoningLevels[0],
      )
    : undefined;
  return selectModel(
    current,
    routes,
    offer,
    thinkingDefault,
    inputs,
    retainModels,
  );
}

export async function collectModelCredentials(
  ui: InstallerPrompts,
  current: InstallationConfiguration["models"],
  inputs: SetupInputs,
) {
  if (current.mode === "litellm" && current.cloud) return current;
  if (current.mode === "external")
    return current.credentialFile
      ? current
      : {
          ...current,
          credentialFile: await secretInput(
            ui,
            inputs,
            "Model gateway key",
            "model-key",
          ),
        };
  if (current.upstreamEnvironmentFile) return current;
  const routes = await modelRoutes(current.configurationFile, inputs);
  const selected = routes.models.find(
    (model) => model.id === routes.defaultModel,
  );
  ui.note(
    `${selected?.name ?? routes.defaultModel}${routes.thinkingDefault ? " · " + routes.thinkingDefault : ""}\nProvider: ${selected?.route ? providerLabel(selected.route) : "Custom"}`,
    "LLM credentials",
  );
  const values = new Map<string, string>();
  for (const model of routes.models.filter((item) => item.enabled)) {
    const route = model.route;
    if (!route)
      throw new InstallationError(
        "invalid_configuration",
        "An enabled model has no provider route.",
      );
    if (values.has(route.apiKeyEnv)) continue;
    const key = await ui.password(`${providerLabel(route)} API key`);
    if (!key.trim() || /[\r\n'"`]/.test(key))
      throw new InstallationError(
        "invalid_configuration",
        "Use a single-line provider key without quote characters.",
      );
    values.set(route.apiKeyEnv, key);
  }
  return {
    ...current,
    upstreamEnvironmentFile: inputs.set(
      "models.env",
      [...values].map(([name, key]) => `${name}='${key}'`).join("\n") + "\n",
    ),
  };
}

async function chooseModelService(
  ui: InstallerPrompts,
  offers: ModelCatalog,
  current: InstallationConfiguration["models"] | undefined,
  previousRoute?: string,
) {
  const cloud = offers.filter((offer) => offer.provider === "ClawScarf Cloud");
  const own = offers.filter((offer) => offer.provider !== "ClawScarf Cloud");
  const service =
    cloud.length && own.length
      ? await ui.select(
          "How would you like to use this model?",
          [
            {
              value: "provider",
              label: "Your own API key",
              hint: "Use your provider account. Your provider bills you.",
            },
            {
              value: "cloud",
              label: "ClawScarf Cloud",
              hint: "No provider key needed. Buy prepaid AI credits from us.",
            },
          ],
          current?.mode === "litellm" && current.cloud ? "cloud" : "provider",
        )
      : cloud.length
        ? "cloud"
        : "provider";
  const candidates = service === "cloud" ? cloud : own;
  const route =
    candidates.length > 1
      ? await ui.select(
          "Provider",
          candidates.map((offer) => ({
            value: offer.model.route.model,
            label: offer.provider,
          })),
          candidates.find((offer) => offer.model.route.model === previousRoute)
            ?.model.route.model ?? candidates[0]?.model.route.model,
        )
      : candidates[0]?.model.route.model;
  const offer = candidates.find(
    (candidate) => candidate.model.route.model === route,
  );
  if (!offer)
    throw new InstallationError(
      "invalid_configuration",
      "This model has no supported route for that AI service.",
    );
  return offer;
}

export async function collectAiService(
  ui: InstallerPrompts,
  catalog: ModelCatalog,
  current: InstallationConfiguration["models"],
  inputs: SetupInputs,
) {
  if (current.mode === "external") return current;
  const routes = await modelRoutes(current.configurationFile, inputs);
  const selected = routes.models.find(
    (model) => model.id === routes.defaultModel,
  );
  const identity = selected?.id;
  const matches = catalog.filter((offer) => offer.model.id === identity);
  if (!matches.length) return current;
  const offer = await chooseModelService(
    ui,
    matches,
    current,
    selected?.route?.model,
  );
  return selectModel(
    current,
    routes,
    offer,
    routes.thinkingDefault,
    inputs,
    true,
  );
}
