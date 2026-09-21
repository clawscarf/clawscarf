import { defaultInstallationDirectory } from "./location.js";
import { resolve } from "node:path";
import { setupContext, assertReleaseCapabilities } from "./setup.js";
import { readJson, readInputFile, fingerprint } from "./files.js";
import { isDeepStrictEqual } from "node:util";
import { SetupInputs } from "./save.js";
import { installationSchema, type InstallationDraft } from "./configuration.js";
import { InstallationError } from "./errors.js";
import {
  selectedDraft,
  selectionSchema,
  type ConfigureOptions,
} from "./options.js";
import { packRequirements } from "./requirements.js";
import { newDirectory } from "./installer/inputs.js";

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

/** Collect the same choices as the menu without prompting or writing any files. */
export async function prepareConfiguration(options: ConfigureOptions) {
  if (options.reapply)
    throw new InstallationError(
      "invalid_configuration",
      "--reapply requires an existing installation.",
    );
  if (!options.recipe)
    throw new InstallationError(
      "invalid_configuration",
      "Unattended new configuration requires --recipe <name-or-file>.",
    );
  const directory = resolve(options.directory ?? defaultInstallationDirectory);
  await newDirectory(directory);
  const context = await setupContext(options);
  const inputs = new SetupInputs(directory);
  const draft = await selectedDraft(
    context,
    context.recipeId ?? options.recipe,
    options,
    inputs,
  );
  const config = await validateSelections(context, draft);
  return { directory, config, inputs };
}

export async function validateSelections(
  context: Awaited<ReturnType<typeof setupContext>>,
  draft: InstallationDraft,
) {
  if (!draft.models)
    throw new InstallationError(
      "invalid_configuration",
      "Choose --model or a recipe with a default model.",
    );
  if (draft.models.mode === "litellm" && !draft.models.upstreamEnvironmentFile)
    throw new InstallationError(
      "invalid_configuration",
      "Supply --llm-key-file or --provider-env-file for the selected model provider.",
    );
  if (draft.models.mode === "external" && !draft.models.credentialFile)
    throw new InstallationError(
      "invalid_configuration",
      "Supply --model-gateway-key-file.",
    );
  if (draft.access.mode === "oidc" && !draft.access.clientSecretFile)
    throw new InstallationError(
      "invalid_configuration",
      "Supply --oidc-secret-file.",
    );
  if (draft.exposure.mode === "https" && !draft.exposure.keyFile)
    throw new InstallationError(
      "invalid_configuration",
      "Supply --tls-key-file.",
    );
  if (draft.packs.length && !draft.packOperator)
    throw new InstallationError(
      "invalid_configuration",
      "Selected experimental packs require --pack-python.",
    );
  const config = installationSchema.parse(draft);
  assertReleaseCapabilities(context, config);
  const issues = await packRequirements(config);
  if (issues.length)
    throw new InstallationError("invalid_configuration", issues.join(" "));
  return config;
}

export async function savedSetup(options: ConfigureOptions) {
  const configFile = resolve(
    options.directory ?? defaultInstallationDirectory,
    "installation.json",
  );
  try {
    const config = installationSchema.parse(await readJson(configFile));
    return { configFile, config };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

export function rejectNewSelections(options: ConfigureOptions) {
  if (
    options.recipe ||
    options.cloudUrl ||
    Object.values(selectionSchema.parse(options)).some(
      (value) => value !== undefined,
    )
  )
    throw new InstallationError(
      "change_unsupported",
      "Setup is unfinished. Resume with configure --directory before changing selections.",
    );
}

/** Compare accepted contents, not the private copy paths created by the menu. */
export async function configurationChanges(
  before: import("./configuration.js").InstallationConfiguration,
  after: import("./configuration.js").InstallationConfiguration,
) {
  const secret = async (path?: string) =>
    path ? fingerprint(await readInputFile(path, true)) : undefined;
  const models = async (config: typeof before) => ({
    mode: config.models.mode,
    catalog: await readJson(config.models.configurationFile),
    key: await secret(
      config.models.mode === "litellm"
        ? config.models.upstreamEnvironmentFile
        : config.models.credentialFile,
    ),
    ca:
      config.models.mode === "external" && config.models.caFile
        ? fingerprint(await readInputFile(config.models.caFile))
        : undefined,
  });
  const packs = async (config: typeof before) => ({
    operator: config.packOperator,
    selections: await Promise.all(
      config.packs.map(async ({ bindingsFile, ...pack }) => ({
        ...pack,
        bindings: bindingsFile ? await readJson(bindingsFile) : undefined,
      })),
    ),
  });
  return {
    models: !isDeepStrictEqual(await models(before), await models(after)),
    connections: !isDeepStrictEqual(before.connections, after.connections),
    publicWeb: before.publicWeb !== after.publicWeb,
    packs: !isDeepStrictEqual(await packs(before), await packs(after)),
  };
}
