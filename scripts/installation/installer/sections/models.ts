import { selectModel } from "../../models.js";
import type { InstallationConfiguration } from "../../configuration.js";
import type { Release } from "../../../release/definition.js";
import type { InstallerPrompts } from "../prompts.js";
import {
  gatewayRoutesSchema,
  configurationSchema,
} from "../../../models/configuration.js";
import { secretInput } from "../secrets.js";
import { inputFile } from "../inputs.js";
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
  release: Release,
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
        "Import the existing gateway's model catalog under Advanced.",
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
  const offers = release.modelCatalog ?? [];
  const choices = new Map([
    ...offers.map((offer) => [offer.model.id, offer.model.name] as const),
    ...(routes?.models.map((model) => [model.id, model.name] as const) ?? []),
  ]);
  if (!choices.size)
    throw new InstallationError(
      "invalid_configuration",
      "This release contains no model choices. Import a catalog under Advanced.",
    );
  const id = await ui.select(
    "Default model",
    [...choices].map(([value, label]) => ({ value, label })),
    routes?.defaultModel,
  );
  const existing = routes?.models.find((model) => model.id === id);
  const matching = offers.filter((offer) => offer.model.id === id);
  const providerOptions = new Map(
    matching.map((offer) => [offer.model.route.model, offer]),
  );
  if (existing?.route && !providerOptions.has(existing.route.model))
    providerOptions.set(existing.route.model, {
      provider: providerLabel(existing.route),
      model: { ...existing, route: existing.route },
      reasoningLevels: existing.reasoning ? ["low", "medium", "high"] : [],
    });
  if (!providerOptions.size)
    throw new InstallationError(
      "invalid_configuration",
      "This model has no configured provider. Choose another model or import a catalog under Advanced.",
    );
  const selectedRoute = await ui.select(
    "Provider",
    [...providerOptions].map(([value, offer]) => ({
      value,
      label: offer.provider,
    })),
    existing?.route?.model,
  );
  const offer = providerOptions.get(selectedRoute);
  if (!offer?.model.route)
    throw new InstallationError(
      "invalid_configuration",
      "Select a supported provider route.",
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
  const mode = await ui.select(
    "LLM API keys",
    [
      { value: "paste", label: "Enter keys (hidden)" },
      { value: "file", label: "Import private credentials file" },
    ],
    "paste",
  );
  if (mode === "file")
    return {
      ...current,
      upstreamEnvironmentFile: await inputFile(
        ui,
        "Provider credentials file (.env)",
        true,
      ),
    };
  const values = new Map<string, string>();
  for (const model of routes.models.filter((item) => item.enabled)) {
    const route = model.route;
    if (!route)
      throw new InstallationError(
        "invalid_configuration",
        "An enabled model has no provider route.",
      );
    if (values.has(route.apiKeyEnv)) continue;
    const key = await ui.password(`${providerLabel(route)} LLM API key`);
    if (!key.trim() || /[\r\n'"`]/.test(key))
      throw new InstallationError(
        "invalid_configuration",
        "Use a single-line provider key without quote characters, or import its credentials file.",
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
