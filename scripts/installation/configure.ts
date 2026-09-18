import { registerCloudServices } from "../cloud/registration.js";
import { packRequirements } from "./requirements.js";
import { InstallationError } from "./errors.js";
import { dirname, resolve } from "node:path";
import {
  setupContext,
  setupDraft,
  assertReleaseCapabilities,
  type SetupOptions,
} from "./setup.js";
import { readJson, readInputFile } from "./files.js";
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
  if (config.access.mode === "hosted")
    config.access.registrationFile = path(config.access.registrationFile);
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
  config.connections.registrationFile = path(
    config.connections.registrationFile,
  );
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
    recipe?: string;
    directory: string;
    settings?: string;
    cloudCredentialFile?: string;
  },
) {
  const authorize = async () => {
    if (!options.cloudCredentialFile)
      throw new InstallationError(
        "invalid_configuration",
        "Hosted registration requires --cloud-credential-file for unattended setup. Use install for browser sign-in.",
      );
    return (await readInputFile(options.cloudCredentialFile, true))
      .toString("utf8")
      .trim();
  };
  const saved = await savedSetup(options);
  if (saved) {
    await registerCloudServices(saved.configFile, authorize);
    return { state: "configured", configFile: saved.configFile };
  }
  if (!options.recipe)
    throw new InstallationError(
      "invalid_configuration",
      "Choose --recipe for a new installation.",
    );
  const context = await setupContext(options);
  const settings = options.settings ? await readJson(options.settings) : {};
  const inputs = new SetupInputs(resolve(options.directory));
  const draft = resolveConfigurationInputs(
    setupDraft(context, options.recipe, settings, inputs),
    options.settings ? dirname(resolve(options.settings)) : process.cwd(),
  );
  if (draft.access.mode === "hosted")
    draft.access.registrationFile = resolve(
      options.directory,
      "secrets/hosted-login.json",
    );
  draft.connections.registrationFile = resolve(
    options.directory,
    "secrets/connections-registration.json",
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
  await registerCloudServices(configFile, authorize);
  return {
    state: "configured",
    configFile,
    release: context.release.version,
    recipe: options.recipe,
  };
}

/** Only install/configure without new selections can resume saved setup. */
export async function savedSetup(options: {
  directory?: string;
  recipe?: string;
  settings?: string;
  release?: string;
  recipes?: string;
  cloudUrl?: string;
}) {
  if (!options.directory) return undefined;
  const configFile = resolve(options.directory, "installation.json");
  let config: ReturnType<typeof installationSchema.parse>;
  try {
    config = installationSchema.parse(await readJson(configFile));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  if (
    options.recipe ||
    options.settings ||
    options.release ||
    options.recipes ||
    options.cloudUrl
  )
    throw new InstallationError(
      "change_unsupported",
      "To resume saved setup, pass only --directory (and a cloud credential file for unattended registration). Use settings for changes to an installed server.",
    );
  return { configFile, config };
}
