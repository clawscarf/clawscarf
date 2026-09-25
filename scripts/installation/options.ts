import { Command, Option } from "commander";
import { resolve } from "node:path";
import { z } from "zod";
import { installationSchema, type InstallationDraft } from "./configuration.js";
import { cloudUrlSchema } from "../cloud/url.js";
import {
  type SetupOptions,
  type SetupContext,
  recipeConfiguration,
  recipeModelFile,
} from "./setup.js";
import { SetupInputs } from "./save.js";
import { readInputFile } from "./files.js";
import { InstallationError } from "./errors.js";
import {
  configurationSchema,
  gatewayRoutesSchema,
} from "../models/configuration.js";
import { selectModel, selectAiService } from "./models.js";
import { openPack } from "../packs/source.js";

const file = z
  .string()
  .min(1)
  .transform((value) => resolve(value));
const port = z.coerce.number().int().min(1024).max(65535);
const text = z.string().min(1);
/** Public selections only; internal paths and bootstrap state are never CLI overrides. */
export const selectionSchema = z.object({
  port: port.optional(),
  widgetPort: port.optional(),
  origin: cloudUrlSchema.optional(),
  widgetOrigin: cloudUrlSchema.optional(),
  tlsCertificate: file.optional(),
  tlsKeyFile: file.optional(),
  access: z.enum(["hosted", "oidc"]).optional(),
  oidcIssuer: z.url().optional(),
  oidcClientId: text.optional(),
  oidcSecretFile: file.optional(),
  administratorSubject: text.optional(),
  administratorEmail: z.email().optional(),
  cpu: installationSchema.shape.resources.shape.runtime.shape.cpu.optional(),
  memory:
    installationSchema.shape.resources.shape.runtime.shape.memory.optional(),
  connections: z.boolean().optional(),
  connectionsCloudUrl: cloudUrlSchema.optional(),
  browser: z.boolean().optional(),
  publicWeb: z.boolean().optional(),
  model: text.optional(),
  aiService: z.enum(["cloud", "provider"]).optional(),
  provider: text.optional(),
  reasoning: z.enum(["low", "medium", "high"]).optional(),
  llmKeyFile: file.optional(),
  providerEnvFile: file.optional(),
  modelCatalog: file.optional(),
  modelGatewayUrl: z.url().optional(),
  modelGatewayKeyFile: file.optional(),
  modelGatewayCaFile: file.optional(),
  pack: z.array(text).optional(),
  packs: z
    .literal(false)
    .nullish()
    .transform((value) => value ?? undefined),
  packBindings: z.array(text).optional(),
  packPython: file.optional(),
});
export type InstallationSelections = z.input<typeof selectionSchema>;
export type ConfigureOptions = SetupOptions &
  InstallationSelections & {
    directory?: string;
    nonInteractive?: boolean;
    yes?: boolean;
    start?: boolean;
    cloudCredentialFile?: string;
    json?: boolean;
    reapply?: "models" | "connections";
    aiCreditOffer?: string;
    allowUnfundedAi?: boolean;
  };

export function installationOptions(command: Command) {
  return command
    .option("--port <number>", "Local application port (default: 18800)")
    .option("--widget-port <number>", "Local widgets port (default: 18802)")
    .option("--origin <url>", "Public HTTPS application origin")
    .option("--widget-origin <url>", "Public HTTPS widgets origin")
    .option("--tls-certificate <file>", "HTTPS certificate")
    .option("--tls-key-file <file>", "Private HTTPS key file")
    .addOption(
      new Option("--access <mode>", "Login provider").choices([
        "hosted",
        "oidc",
      ]),
    )
    .option("--oidc-issuer <url>", "Company OIDC issuer")
    .option("--oidc-client-id <id>", "Company OIDC client ID")
    .option("--oidc-secret-file <file>", "Private company OIDC client secret")
    .option(
      "--administrator-subject <subject>",
      "First administrator OIDC subject (for unattended setup)",
    )
    .option(
      "--administrator-email <email>",
      "First administrator email (with --administrator-subject)",
    )
    .option("--cpu <count>", "Runtime CPU allocation")
    .option("--memory <size>", "Runtime memory, for example 4Gi")
    .option("--connections", "Enable Connections")
    .option("--no-connections", "Disable Connections")
    .option(
      "--connections-cloud-url <url>",
      "Use a separate Connections service",
    )
    .option("--browser", "Enable the shared browser (administrators only)")
    .option("--no-browser", "Disable browser capability")
    .option("--public-web", "Allow public HTTP(S) from agents and tools")
    .option("--no-public-web", "Restrict runtime egress to configured services")
    .option("--model <id>", "Default model from the model catalog")
    .addOption(
      new Option(
        "--ai-service <service>",
        "AI billing: Cloud prepaid credits or your provider key",
      ).choices(["cloud", "provider"]),
    )
    .option(
      "--ai-credit-offer <id>",
      "Open checkout for one Cloud AI credit pack (unattended setup)",
    )
    .option(
      "--allow-unfunded-ai",
      "Finish setup even when Cloud AI is not ready; add credits in Account later",
    )
    .option(
      "--provider <id>",
      "Model provider, for example openai or openrouter",
    )
    .addOption(
      new Option("--reasoning <level>", "Model reasoning level").choices([
        "low",
        "medium",
        "high",
      ]),
    )
    .option(
      "--llm-key-file <file>",
      "Private file containing the selected provider's API key",
    )
    .option(
      "--provider-env-file <file>",
      "Private provider credentials file for multiple model routes",
    )
    .option("--model-catalog <file>", "Advanced: import a model catalog")
    .option(
      "--model-gateway-url <url>",
      "Advanced: existing LiteLLM endpoint ending in /v1",
    )
    .option(
      "--model-gateway-key-file <file>",
      "Private key for an existing LiteLLM gateway",
    )
    .option(
      "--model-gateway-ca-file <file>",
      "Private CA for an existing LiteLLM gateway",
    )
    .option(
      "--pack <id:members>",
      "Select bundled pack members; repeat for multiple packs",
      append,
    )
    .addOption(
      new Option("--no-packs", "Remove all recipe pack selections").default(
        null,
      ),
    )
    .option(
      "--pack-bindings <id=file>",
      "Account bindings for a selected pack; repeat as needed",
      append,
    )
    .option(
      "--pack-python <file>",
      "Python with the pinned OpenShell SDK for experimental packs",
    );
}
function append(value: string, previous: string[] = []) {
  return [...previous, value];
}
function invalid(message: string): never {
  throw new InstallationError("invalid_configuration", message);
}

export async function selectedDraft(
  context: SetupContext,
  recipe: string,
  selections: InstallationSelections,
  inputs: SetupInputs,
  retained?: InstallationDraft,
): Promise<InstallationDraft> {
  const o = selectionSchema.parse(selections);
  if (retained) {
    const mutable = new Set([
      "model",
      "aiService",
      "provider",
      "reasoning",
      "llmKeyFile",
      "providerEnvFile",
      "modelCatalog",
      "modelGatewayKeyFile",
      "modelGatewayCaFile",
      "connections",
      "browser",
      "publicWeb",
      "connectionsCloudUrl",
      "pack",
      "packs",
      "packBindings",
      "packPython",
    ]);
    if (
      Object.entries(o).some(
        ([key, value]) => value !== undefined && !mutable.has(key),
      )
    )
      invalid(
        "Existing installations support changes to models, keys, Connections, browser, public web and packs only.",
      );
  }
  const config = structuredClone(
    retained ?? recipeConfiguration(context, recipe, inputs.directory),
  );
  if (o.cpu !== undefined) config.resources.runtime.cpu = o.cpu;
  if (o.memory !== undefined) config.resources.runtime.memory = o.memory;
  if (o.browser !== undefined) config.browser.enabled = o.browser;
  if (o.publicWeb !== undefined) config.publicWeb = o.publicWeb;
  if (o.connections !== undefined)
    config.connections.mode = o.connections ? "hosted" : "disabled";
  if (o.connectionsCloudUrl)
    config.connections.cloudUrl = o.connectionsCloudUrl;
  const https = o.origin || o.widgetOrigin || o.tlsCertificate || o.tlsKeyFile;
  if (https) {
    if (o.port !== undefined || o.widgetPort !== undefined)
      invalid("Use local ports or HTTPS origins, not both.");
    if (!o.origin || !o.widgetOrigin || !o.tlsCertificate)
      invalid(
        "HTTPS requires --origin, --widget-origin and --tls-certificate.",
      );
    if (!o.origin.startsWith("https:") || !o.widgetOrigin.startsWith("https:"))
      invalid("Public origins must use HTTPS.");
    config.exposure = {
      mode: "https",
      applicationOrigin: o.origin,
      widgetOrigin: o.widgetOrigin,
      certificateFile: o.tlsCertificate,
      keyFile: o.tlsKeyFile ?? "",
    };
  } else if (config.exposure.mode === "local") {
    config.exposure.applicationPort = o.port ?? config.exposure.applicationPort;
    config.exposure.widgetPort = o.widgetPort ?? config.exposure.widgetPort;
    if (config.exposure.applicationPort === config.exposure.widgetPort)
      invalid("Application and widgets must use different ports.");
  }
  const oidc = o.oidcIssuer || o.oidcClientId || o.oidcSecretFile;
  if (oidc || o.access === "oidc") {
    if (o.access === "hosted")
      invalid("Company OIDC options conflict with --access hosted.");
    if (!o.oidcIssuer || !o.oidcClientId)
      invalid("Company login requires --oidc-issuer and --oidc-client-id.");
    config.access = {
      mode: "oidc",
      issuer: o.oidcIssuer,
      clientId: o.oidcClientId,
      clientSecretFile: o.oidcSecretFile ?? "",
    };
  }
  if (Boolean(o.administratorSubject) !== Boolean(o.administratorEmail))
    invalid("Supply both --administrator-subject and --administrator-email.");
  if (o.administratorSubject && o.administratorEmail) {
    config.access.administratorSubject = o.administratorSubject;
    config.access.administratorEmail = o.administratorEmail;
  }
  if (o.pack && o.packs === false)
    invalid("Use --pack or --no-packs, not both.");
  if (o.packs === false) config.packs = [];
  if (o.pack) {
    config.packs = [];
    for (const choice of o.pack) {
      const [id, members, extra] = choice.split(":");
      if (
        !id ||
        !members ||
        extra !== undefined ||
        !context.packs.some((pack) => pack.id === id)
      )
        invalid(
          "Use --pack <pack-id:member,member>; list available packs with clawscarf recipes.",
        );
      const directory = context.packs.find((pack) => pack.id === id)?.directory;
      if (!directory) invalid(`Unknown pack: ${id}`);
      const pack = await openPack(directory);
      const selected = members.split(",");
      if (
        config.packs.some((item) => item.directory === directory) ||
        new Set(selected).size !== selected.length ||
        selected.some(
          (member) => !pack.manifest.members.some((item) => item.id === member),
        )
      )
        invalid("Select each pack once and use its declared member IDs.");
      config.packs.push({ directory, members: selected });
    }
  }
  for (const binding of o.packBindings ?? []) {
    const separator = binding.indexOf("=");
    const id = binding.slice(0, separator),
      path = binding.slice(separator + 1);
    const selected = config.packs.find(
      (pack) =>
        pack.directory ===
        context.packs.find((pack) => pack.id === id)?.directory,
    );
    if (separator < 1 || !path || !selected)
      invalid("Use --pack-bindings <selected-pack-id=file>.");
    selected.bindingsFile = resolve(path);
  }
  if (o.packPython && !config.packs.length)
    invalid("--pack-python requires a selected pack.");
  if (!config.packs.length) delete config.packOperator;
  else if (o.packPython)
    config.packOperator = {
      pythonExecutable: o.packPython,
      experimentalClaws: true,
    };

  const preset = context.recipes.find((item) => item.id === recipe)?.models;
  if (!config.models && preset)
    config.models = {
      mode: "litellm",
      configurationFile: recipeModelFile(
        preset,
        inputs,
        context.modelCatalog,
        context.cloudUrl,
      ),
      upstreamEnvironmentFile:
        preset.service === "cloud" ? "./secrets/cloud-ai.env" : "",
      ...(preset.service === "cloud"
        ? {
            cloud: {
              url: context.cloudUrl,
              registrationFile: "./secrets/ai-registration.json",
            },
          }
        : {}),
    };
  if (o.modelCatalog)
    config.models =
      config.models?.mode === "external"
        ? { ...config.models, configurationFile: o.modelCatalog }
        : {
            mode: "litellm",
            configurationFile: o.modelCatalog,
            upstreamEnvironmentFile: "",
          };
  if (
    o.aiService === "cloud" &&
    (o.provider || o.llmKeyFile || o.providerEnvFile || o.modelGatewayUrl)
  )
    invalid(
      "Cloud AI uses its own scoped credential. Do not supply provider keys or an external gateway.",
    );
  const requestedService =
    o.aiService ??
    (o.provider || o.llmKeyFile || o.providerEnvFile ? "provider" : undefined);
  let changedAiService = false;
  if (requestedService && config.models) {
    if (config.models.mode === "external")
      invalid("Select a bundled model gateway before changing its AI service.");
    if (Boolean(config.models.cloud) !== (requestedService === "cloud")) {
      changedAiService = true;
      config.models = await selectAiService(
        requestedService,
        config.models,
        context.modelCatalog,
        inputs,
        o.model,
      );
    }
  }
  const current = config.models;
  const catalog = current
    ? await inputs.readJson(current.configurationFile)
    : undefined;
  if (o.modelGatewayUrl) {
    if (!catalog)
      invalid(
        "An existing gateway requires a recipe model or --model-catalog.",
      );
    const parsed = z
      .union([gatewayRoutesSchema, configurationSchema])
      .parse(catalog);
    if ("mode" in parsed && parsed.mode === "disabled")
      invalid("The model gateway must be enabled.");
    config.models = {
      mode: "external",
      configurationFile: inputs.set(
        "external-models.json",
        JSON.stringify(
          configurationSchema.parse({
            ...parsed,
            mode: "external",
            baseUrl: o.modelGatewayUrl,
          }),
        ),
      ),
      credentialFile: o.modelGatewayKeyFile ?? "",
      ...(o.modelGatewayCaFile ? { caFile: o.modelGatewayCaFile } : {}),
    };
  } else if (o.modelGatewayKeyFile || o.modelGatewayCaFile) {
    if (config.models?.mode !== "external")
      invalid("Gateway credentials require --model-gateway-url.");
    if (o.modelGatewayKeyFile)
      config.models.credentialFile = o.modelGatewayKeyFile;
    if (o.modelGatewayCaFile) config.models.caFile = o.modelGatewayCaFile;
  }
  if (o.model || o.provider || o.reasoning) {
    if (config.models?.mode === "external") {
      if (o.provider)
        invalid(
          "Providers for an existing gateway are configured by its operator.",
        );
      const parsed = configurationSchema.parse(
        await inputs.readJson(config.models.configurationFile),
      );
      if (parsed.mode !== "external")
        invalid("Expected an external model gateway.");
      const id = o.model ?? parsed.defaultModel;
      const model = parsed.models.find(
        (item) => item.id === id && item.enabled,
      );
      if (!model) invalid("Select an enabled model from the gateway catalog.");
      if (o.reasoning && !model.reasoning)
        invalid("This model does not support reasoning levels.");
      const { thinkingDefault: previous, ...base } = parsed;
      config.models.configurationFile = inputs.set(
        "external-models.json",
        JSON.stringify({
          ...base,
          defaultModel: id,
          ...(model.reasoning && (o.reasoning ?? previous)
            ? { thinkingDefault: o.reasoning ?? previous }
            : {}),
        }),
      );
    } else {
      const routes = catalog ? gatewayRoutesSchema.parse(catalog) : undefined;
      const id = o.model ?? routes?.defaultModel;
      if (!id)
        invalid(
          "Select --model before choosing a provider or reasoning level.",
        );
      const existing = routes?.models.find((item) => item.id === id);
      const isCloud =
        config.models?.mode === "litellm" && Boolean(config.models.cloud);
      const offers = context.modelCatalog.filter(
        (offer) => (offer.provider === "ClawScarf Cloud") === isCloud,
      );
      if (
        existing?.route &&
        !offers.some(
          (offer) =>
            offer.model.id === id &&
            offer.model.route.model === existing.route?.model,
        )
      )
        offers.unshift({
          provider: existing.route.model.split("/")[0] ?? "",
          model: { ...existing, route: existing.route },
          reasoningLevels: existing.reasoning ? ["low", "medium", "high"] : [],
        });
      const matching = offers.filter(
        (offer) =>
          offer.model.id === id &&
          (!o.provider || offer.model.route.model.split("/")[0] === o.provider),
      );
      const offer =
        matching.find(
          (item) => item.model.route.model === existing?.route?.model,
        ) ?? matching[0];
      if (!offer)
        invalid(
          "Unknown model/provider selection. Use clawscarf recipes to see the model catalog.",
        );
      if (o.reasoning && !offer.reasoningLevels.includes(o.reasoning))
        invalid(
          "The selected model/provider does not support this reasoning level.",
        );
      const thinking =
        o.reasoning ??
        (routes?.thinkingDefault &&
        offer.reasoningLevels.includes(routes.thinkingDefault)
          ? routes.thinkingDefault
          : offer.reasoningLevels.includes("medium")
            ? "medium"
            : offer.reasoningLevels[0]);
      config.models = selectModel(
        current,
        routes,
        offer,
        thinking,
        inputs,
        Boolean(retained) && !changedAiService,
      );
    }
  }
  if (o.llmKeyFile && o.providerEnvFile)
    invalid("Use --llm-key-file or --provider-env-file, not both.");
  if (config.models?.mode === "external" && (o.llmKeyFile || o.providerEnvFile))
    invalid("Use --model-gateway-key-file for an existing gateway.");
  if (!config.models && (o.llmKeyFile || o.providerEnvFile))
    invalid("Select a recipe model or --model before supplying credentials.");
  if (config.models?.mode === "litellm" && !config.models.cloud) {
    if (o.providerEnvFile)
      config.models.upstreamEnvironmentFile = o.providerEnvFile;
    if (o.llmKeyFile) {
      const routes = gatewayRoutesSchema.parse(
        await inputs.readJson(config.models.configurationFile),
      );
      const variables = new Set(
        routes.models
          .filter((model) => model.enabled)
          .map((model) => model.route?.apiKeyEnv),
      );
      const [variable] = variables;
      if (variables.size !== 1 || !variable)
        invalid("Multiple provider keys require --provider-env-file.");
      const key = (await readInputFile(o.llmKeyFile, true))
        .toString("utf8")
        .trim();
      if (!key || /[\r\n'"`]/.test(key))
        invalid(
          "The LLM key file must contain one nonempty key without quotes.",
        );
      config.models.upstreamEnvironmentFile = inputs.set(
        "models.env",
        `${variable}='${key}'\n`,
      );
    }
  }
  if (!retained) {
    if (config.access.mode === "hosted")
      config.access.registrationFile = resolve(
        inputs.directory,
        "secrets/hosted-login.json",
      );
    config.connections.registrationFile = resolve(
      inputs.directory,
      "secrets/connections-registration.json",
    );
    if (config.models?.mode === "litellm" && config.models.cloud)
      config.models.cloud.registrationFile = resolve(
        inputs.directory,
        "secrets/ai-registration.json",
      );
  }
  return config;
}
