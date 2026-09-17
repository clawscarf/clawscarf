import { packRequirements } from "./requirements.js";
import { InstallationError } from "./errors.js";
import { dirname, resolve } from "node:path";
import {
  setupContext,
  setupDraft,
  assertReleaseCapabilities,
  type SetupOptions,
} from "./setup.js";
import { readJson } from "./files.js";
import { saveConfiguration, SetupInputs } from "./save.js";
import { installationSchema, type InstallationDraft } from "./configuration.js";

/** Resolve input references against the settings document; state stays relative to the output. */
export function resolveConfigurationInputs<T extends InstallationDraft>(
  value: T,
  base: string,
) {
  const config = structuredClone(value);
  const path = (input: string) => (input ? resolve(base, input) : input);
  config.releaseFile = path(config.releaseFile);
  if (config.access.mode === "oidc")
    config.access.clientSecretFile = path(config.access.clientSecretFile);
  if (config.exposure.mode === "https") {
    config.exposure.certificateFile = path(config.exposure.certificateFile);
    config.exposure.keyFile = path(config.exposure.keyFile);
  }
  if (config.models) {
    config.models.configurationFile = path(config.models.configurationFile);
    if (config.models.mode === "external") {
      config.models.credentialFile = path(config.models.credentialFile);
      if (config.models.caFile)
        config.models.caFile = path(config.models.caFile);
    } else
      config.models.upstreamEnvironmentFile = path(
        config.models.upstreamEnvironmentFile,
      );
  }
  if (config.connections.mode === "local") {
    config.connections.apiKeyFile = path(config.connections.apiKeyFile);
    config.connections.catalogDirectory = path(
      config.connections.catalogDirectory,
    );
  } else if (config.connections.mode === "external") {
    config.connections.credentialFile = path(config.connections.credentialFile);
    if (config.connections.caFile)
      config.connections.caFile = path(config.connections.caFile);
  }
  for (const pack of config.packs) {
    pack.directory = path(pack.directory);
    if (pack.bindingsFile) pack.bindingsFile = path(pack.bindingsFile);
  }
  if (config.packOperator)
    config.packOperator.pythonExecutable = path(
      config.packOperator.pythonExecutable,
    );
  return config;
}

export async function configureInstallation(
  options: SetupOptions & {
    recipe: string;
    directory: string;
    settings?: string;
  },
) {
  const context = await setupContext(options);
  const settings = options.settings ? await readJson(options.settings) : {};
  const inputs = new SetupInputs(resolve(options.directory));
  const draft = resolveConfigurationInputs(
    setupDraft(context, options.recipe, settings, inputs),
    options.settings ? dirname(resolve(options.settings)) : process.cwd(),
  );
  if (!draft.models)
    throw new InstallationError(
      "invalid_configuration",
      "Models require LiteLLM configuration and provider credentials. Supply models in --settings.",
    );
  const config = installationSchema.parse(draft);
  assertReleaseCapabilities(context, config);
  const issues = await packRequirements(config);
  if (issues.length)
    throw new InstallationError("invalid_configuration", issues.join(" "));
  const configFile = await saveConfiguration(
    resolve(options.directory),
    config,
    inputs,
  );
  return {
    state: "configured",
    configFile,
    release: context.release.version,
    recipe: options.recipe,
  };
}
