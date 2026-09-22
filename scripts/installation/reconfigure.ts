import { publicWebPolicy } from "../deployment/public-web.js";
import { stageNetworkPolicyChange } from "../deployment/network-policy.js";
import { applyConnectionSettings } from "../deployment/connection-settings.js";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { compose } from "../deployment/compose.js";
import { setRuntimeCredentialModels } from "../models/credentials.js";
import {
  configurationChanges,
  resolveConfigurationInputs,
} from "./configure.js";
import { ModelConfigurationError } from "../../runtime/model-contract.js";
import {
  loadGatewayConfiguration,
  prepareModelGateway,
} from "../deployment/model-gateway.js";
import {
  readInitialConnectionsEndpoint,
  loadInitialConnections,
  prepareInitialConnections,
} from "../deployment/connections.js";
import { configureStoppedRuntimeModels } from "../models/runtime.js";
import { loadInitialModels } from "../deployment/models.js";
import {
  readState,
  resourceNames,
  withInstallationLock,
  writePrivate,
} from "../deployment/state.js";
import { run } from "../deployment/process.js";
import { selectionSchema } from "./packs.js";
import { installationSchema } from "./configuration.js";
import { resolveInstallation } from "./resolve.js";
import { readJson, fingerprint } from "./files.js";
import { InstallationError } from "./errors.js";

function unsupported(message: string): never {
  throw new InstallationError("change_unsupported", message);
}

/** Deliberately bounded: initial preparation is never used to replace retained state. */
export async function planSettingsChange(
  configFile: string,
  reapply?: "models" | "connections",
) {
  const config = installationSchema.parse(await readJson(configFile));
  const directory = resolve(
    dirname(resolve(configFile)),
    config.stateDirectory,
  );
  const state = await readState(directory);
  const old = state.input;
  const desired = await resolveInstallation(configFile, [
    old.ports.controller,
    old.ports.management,
    old.ports.native,
    old.ports.nativeWidgets,
    old.ports.database,
    old.browser?.port ?? 65534,
    old.modelGateway?.port ?? 65533,
  ]);
  const next = desired.input;
  const previousPacks = selectionSchema.parse(
    await readJson(join(directory, "packs.json")),
  );
  if (!desired.packSelection.python && previousPacks.python)
    desired.packSelection.python = previousPacks.python;
  const {
    models: _oldModels,
    modelGateway: oldGateway,
    connections: oldConnections,
    publicWeb: oldPublicWeb,
    ...oldFixed
  } = old;
  const {
    models: _nextModels,
    modelGateway: nextGateway,
    connections: nextConnections,
    publicWeb: nextPublicWeb,
    ...nextFixed
  } = next;
  if (
    !isDeepStrictEqual(oldFixed, nextFixed) ||
    !isDeepStrictEqual(
      await readJson(join(directory, "release.json")),
      desired.release,
    )
  )
    unsupported(
      "Settings changes cannot replace the release, identity, addresses, access, resources or execution protection.",
    );
  if (
    Boolean(oldGateway) !== Boolean(nextGateway) ||
    (oldGateway &&
      nextGateway &&
      (oldGateway.image !== nextGateway.image ||
        oldGateway.port !== nextGateway.port))
  )
    unsupported(
      "Switching between bundled and external model gateways requires a deployment change.",
    );
  if (!nextGateway) {
    const before = await loadInitialModels(old.models);
    const after = await loadInitialModels(next.models);
    if (!before || !after || !isDeepStrictEqual(before.network, after.network))
      unsupported(
        "Changing the external model gateway address requires updating its protected network policy.",
      );
  }
  const previousEndpoint = await readInitialConnectionsEndpoint(directory);
  const connections = await loadInitialConnections(next.connections);
  await prepareInitialConnections(directory, connections, {
    state: { ...state, input: next },
    apply: false,
  });
  const modelConfiguration = nextGateway
    ? (
        await loadGatewayConfiguration(
          nextGateway.configurationFile,
          nextGateway.upstreamEnvironmentFile,
        )
      ).configuration
    : (await loadInitialModels(next.models))?.configuration;
  const pending = z
    .strictObject({
      ownerId: z.literal(state.ownerId),
      settingsPending: z.string().optional(),
      settingsCandidate: z.string().optional(),
      settingsReapply: z.enum(["models", "connections"]).optional(),
    })
    .parse(await readJson(join(directory, "prepared.json")));
  if (
    pending.settingsPending &&
    pending.settingsPending !== desired.fingerprint
  )
    unsupported(
      "Finish the pending settings change with its original candidate before selecting another configuration.",
    );
  if (pending.settingsReapply && reapply && pending.settingsReapply !== reapply)
    unsupported(
      "Resume the pending change before selecting another capability to reapply.",
    );
  reapply ??= pending.settingsReapply;
  const scopes = await configurationChanges(
    installationSchema.parse(await readJson(join(directory, "settings.json"))),
    resolveConfigurationInputs(config, dirname(resolve(configFile))),
  );
  if (reapply) scopes[reapply] = true;
  return {
    directory,
    state,
    desired,
    previousEndpoint,
    scopes,
    reapply,
    changes: {
      publicWeb: { from: oldPublicWeb, to: nextPublicWeb },
      models: modelConfiguration
        ? {
            enabled: modelConfiguration.models
              .filter((model) => model.enabled)
              .map((model) => model.id),
            default: modelConfiguration.defaultModel,
            reasoning: modelConfiguration.thinkingDefault ?? "unchanged",
          }
        : undefined,
      connections: {
        from: oldConnections?.mode ?? "disabled",
        to: nextConnections?.mode ?? "disabled",
      },
      packs: {
        selected: desired.packSelection.packs.flatMap((pack) => pack.members),
        removed: previousPacks.packs
          .flatMap((pack) => pack.members)
          .filter(
            (member) =>
              !desired.packSelection.packs.some((pack) =>
                pack.members.includes(member),
              ),
          ),
      },
    },
    fingerprint: fingerprint(
      JSON.stringify({
        scopes,
        reapply,
        desired: desired.fingerprint,
        state,
        previousPacks,
        accepted: await readFile(join(directory, "inputs.sha256"), "utf8"),
        pending: pending.settingsPending ?? null,
      }),
    ),
    resuming: !!pending.settingsPending,
  };
}

/** Explicit retained capability changes; native users and individual model overrides remain native-owned. */
export async function reconfigureInstallation(
  configFile: string,
  expectedFingerprint: string,
  reapply?: "models" | "connections",
) {
  const config = installationSchema.parse(await readJson(configFile));
  const location = resolve(dirname(resolve(configFile)), config.stateDirectory);
  return withInstallationLock(location, async () => {
    const checked = await planSettingsChange(configFile, reapply);
    if (
      checked.directory !== location ||
      checked.fingerprint !== expectedFingerprint
    )
      throw new InstallationError(
        "stale_plan",
        "Settings changed after preview. Review them again.",
      );
    const { directory, state, desired, scopes } = checked;
    if (!checked.resuming && !Object.values(scopes).some(Boolean))
      return { state: "unchanged", restartRequired: false, directory };
    const names = resourceNames(state);
    for (const filter of [
      `label=com.docker.compose.project=${names.project}`,
      `volume=${names.volume}`,
    ])
      if (
        (
          await run("docker", [
            "container",
            "ls",
            "--quiet",
            "--filter",
            filter,
          ])
        ).trim()
      )
        unsupported("Stop this installation before applying settings.");
    const volume = z
      .object({
        Name: z.literal(names.volume),
        Labels: z.record(z.string(), z.string()),
      })
      .parse(
        JSON.parse(
          await run("docker", [
            "volume",
            "inspect",
            "--format",
            '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
            names.volume,
          ]),
        ),
      );
    if (volume.Labels["clawscarf.installation"] !== state.ownerId)
      unsupported(
        "The native home volume does not belong to this installation.",
      );
    const prepared = join(directory, "prepared.json");
    let models = await loadInitialModels(state.input.models);
    const gateway = desired.input.modelGateway;
    const loaded = gateway
      ? await loadGatewayConfiguration(
          gateway.configurationFile,
          gateway.upstreamEnvironmentFile,
        )
      : undefined;
    if (!gateway) models = await loadInitialModels(desired.input.models);
    if (!models || (loaded && !loaded.configuration.defaultModel))
      throw new InstallationError(
        "invalid_configuration",
        "Model settings and an enabled default are required.",
      );
    if (loaded && loaded.configuration.defaultModel)
      models.configuration = {
        ...loaded.configuration,
        defaultModel: loaded.configuration.defaultModel,
        baseUrl: models.configuration.baseUrl,
      };
    // Check the packaged helper and native validation before changing retained service files.
    if (scopes.models)
      await configureStoppedRuntimeModels({
        image: state.input.runtimeImage,
        volume: names.volume,
        configuration: models.configuration,
        credential: models.credential,
        apply: false,
      });
    // Startup already requires this exact prepared record. An interrupted mutation must not announce readiness.
    await writePrivate(
      prepared,
      JSON.stringify({
        ownerId: state.ownerId,
        settingsPending: desired.fingerprint,
        settingsCandidate: resolve(configFile),
        ...(checked.reapply ? { settingsReapply: checked.reapply } : {}),
      }),
    );
    let stage = "model gateway configuration";
    try {
      if (scopes.models) {
        await prepareModelGateway(
          directory,
          { ...state, input: desired.input },
          { replaceConfiguration: true },
        );
        if (gateway && loaded)
          try {
            stage = "model credential permissions";
            await compose(directory, [
              "up",
              "-d",
              "--wait",
              "--wait-timeout",
              "120",
              "models",
            ]);
            await setRuntimeCredentialModels({
              origin: `https://127.0.0.1:${String(gateway.port)}`,
              masterKeyFile: join(directory, "private/models/master-key"),
              keyFile: join(directory, "private/models/runtime-key"),
              caFile: join(directory, "private/management-ca.pem"),
              models: loaded.configuration.models
                .filter((model) => model.enabled)
                .map((model) => model.id),
            });
          } finally {
            await compose(directory, ["stop", "models", "models-database"]);
          }
        stage = "native model configuration";
        await configureStoppedRuntimeModels({
          image: state.input.runtimeImage,
          volume: names.volume,
          configuration: models.configuration,
          credential: models.credential,
          apply: true,
        });
      }
      stage = "Connections configuration";
      if (
        scopes.connections &&
        (state.input.connections || desired.input.connections)
      )
        await applyConnectionSettings(
          directory,
          { ...state, input: desired.input },
          checked.previousEndpoint,
          desired.connectorCredentialFile,
        );
      stage = "public web policy";
      if (scopes.publicWeb)
        await stageNetworkPolicyChange(directory, state, {
          public_web: publicWebPolicy(desired.input.publicWeb),
        });
      stage = "accepted settings";
      if (scopes.models)
        await writePrivate(
          join(directory, "private/model-bootstrap.json"),
          JSON.stringify(models),
        );
      await writePrivate(
        join(directory, "packs.json"),
        JSON.stringify(desired.packSelection),
      );
      await writePrivate(
        join(directory, "installation.json"),
        JSON.stringify({ ...state, input: desired.input }, null, 2),
      );
      await writePrivate(join(directory, "inputs.sha256"), desired.fingerprint);
      await writePrivate(
        join(directory, "settings.json"),
        JSON.stringify(
          {
            ...resolveConfigurationInputs(
              desired.config,
              dirname(resolve(configFile)),
            ),
            stateDirectory: directory,
          },
          null,
          2,
        ),
      );
      await writePrivate(prepared, JSON.stringify({ ownerId: state.ownerId }));
      return { state: "configured", restartRequired: true, directory };
    } catch (error) {
      throw new InstallationError(
        "unavailable",
        `Settings were not confirmed during ${stage}; the installation remains stopped. Run configure --directory again to review and explicitly resume the same change. The gateway key is observed first and matching native settings are not repeated.${error instanceof ModelConfigurationError ? ` Native result: ${error.code}.` : ""}`,
      );
    }
  });
}
