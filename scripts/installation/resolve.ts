import { verifyReleaseTool } from "./files.js";
import {
  hostedOidc,
  hostedConnections,
  hostedBilling,
} from "../cloud/registration.js";
import { dirname, resolve, join } from "node:path";
import { loadGatewayConfiguration } from "../deployment/model-gateway.js";
import { createServer } from "node:net";
import { releaseSchema, releaseTools } from "../release/definition.js";
import {
  parseLocalInput,
  type LocalInput,
} from "../deployment/configuration.js";
import { loadInitialModels } from "../deployment/models.js";
import {
  loadInitialConnections,
  readInitialConnectionToken,
} from "../deployment/connections.js";
import { readTeamMaterials } from "../deployment/team.js";
import { installationSchema } from "./configuration.js";
import { fingerprint, readInputFile, readJson } from "./files.js";
import { InstallationError } from "./errors.js";
import { openPack } from "../packs/source.js";
import { validateCloudRoutes } from "../cloud/models.js";

export async function allocatePorts() {
  const servers = Array.from({ length: 7 }, () => createServer());
  try {
    const ports: number[] = [];
    for (const server of servers) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new InstallationError(
          "unavailable",
          "Cannot allocate local ports.",
        );
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(
      servers
        .filter((s) => s.listening)
        .map(
          (s) =>
            new Promise<void>((resolve, reject) =>
              s.close((error) => {
                if (error) reject(error);
                else resolve();
              }),
            ),
        ),
    );
  }
}
/** Resolve files against their owning document; validate before any allocation. */
export async function resolveInstallation(
  configFile: string,
  internalPorts: number[],
) {
  const config = installationSchema.parse(await readJson(configFile));
  const base = dirname(resolve(configFile));
  const path = (value: string) => resolve(base, value);
  const releasePath = path(config.releaseFile);
  const release = releaseSchema.parse(await readJson(releasePath));
  if (
    config.models.mode === "litellm" &&
    config.models.cloud &&
    !release.cloudBilling
  )
    throw new InstallationError(
      "invalid_configuration",
      "This runtime predates Cloud AI and Account billing. Select a runtime with Cloud billing support, or use your own provider key.",
    );
  if (
    !release.platforms.some(
      (platform) => platform === `${process.platform}-${process.arch}`,
    )
  )
    throw new InstallationError(
      "unsupported_platform",
      "This release does not support this host platform.",
    );
  const toolBase = dirname(releasePath);
  const tools = releaseTools(release);
  const cli = resolve(toolBase, tools.cli.file);
  const gateway = resolve(toolBase, tools.gateway.file);
  await verifyReleaseTool(cli, tools.cli.sha256);
  await verifyReleaseTool(gateway, tools.gateway.sha256);
  const [
    controller,
    management,
    native,
    nativeWidgets,
    database,
    browser,
    models,
  ] = internalPorts;
  const inputs: Record<string, string> = {};
  async function inputFile(value: string, secret: boolean) {
    const filename = path(value);
    inputs[filename] = fingerprint(await readInputFile(filename, secret));
    return filename;
  }
  const exposure = config.exposure;
  const access =
    config.access.mode === "hosted"
      ? {
          ...config.access,
          ...(await hostedOidc(
            await inputFile(config.access.registrationFile, true),
          )),
        }
      : config.access;
  const cloudConnections = await hostedConnections(config, configFile);
  if (config.models.mode === "litellm" && config.models.cloud)
    validateCloudRoutes(
      await readJson(path(config.models.configurationFile)),
      config.models.cloud.url,
    );
  const cloudServices = release.cloudBilling
    ? await hostedBilling(config, configFile)
    : [];
  for (const target of cloudServices)
    await inputFile(target.managementKeyFile, true);
  const input: LocalInput = parseLocalInput({
    ...(cloudServices.length ? { cloudServices } : {}),
    name: config.name,
    administratorName: access.administratorName,
    runtimeImage: release.images.gateway,
    publicWeb: config.publicWeb,
    companionImage: release.images.companion,
    ...(config.browser.enabled ? { relayImage: release.images.relay } : {}),
    openshellCli: cli,
    openshellGateway: gateway,
    openshellClientImage: release.images.openshellClient,
    cpu: config.resources.runtime.cpu,
    memory: config.resources.runtime.memory,
    ports: {
      controller,
      management,
      native,
      nativeWidgets,
      database,
      application:
        exposure.mode === "local"
          ? exposure.applicationPort
          : Number(new URL(exposure.applicationOrigin).port || "443"),
      widgets:
        exposure.mode === "local"
          ? exposure.widgetPort
          : Number(new URL(exposure.widgetOrigin).port || "443"),
    },
    ...(config.browser.enabled
      ? {
          browser: {
            image: release.images.browser?.chromium,
            nodeImage: release.images.browser?.node,
            dnsImage: release.images.browser?.dns,
            egressImage: release.images.browser?.egress,
            port: browser,
          },
        }
      : {}),
    team: {
      ...(exposure.mode === "https"
        ? {
            origin: exposure.applicationOrigin,
            widgetOrigin: exposure.widgetOrigin,
            certificateFile: await inputFile(exposure.certificateFile, false),
            keyFile: await inputFile(exposure.keyFile, true),
          }
        : {
            origin: `http://127.0.0.1:${String(exposure.applicationPort)}`,
            widgetOrigin: `http://127.0.0.1:${String(exposure.widgetPort)}`,
          }),
      issuer: access.issuer,
      clientId: access.clientId,
      clientSecretFile: await inputFile(access.clientSecretFile, true),
      ...("administratorSubject" in access && access.administratorSubject
        ? {
            administratorSubject: access.administratorSubject,
            administratorEmail: access.administratorEmail,
          }
        : {}),
    },
    ...(config.models.mode === "external"
      ? {
          models: {
            configurationFile: await inputFile(
              config.models.configurationFile,
              false,
            ),
            runtimeKeyFile: await inputFile(config.models.credentialFile, true),
            ...(config.models.caFile
              ? { caFile: await inputFile(config.models.caFile, false) }
              : {}),
          },
        }
      : {}),
    ...(config.models.mode === "litellm"
      ? {
          modelGateway: {
            configurationFile: await inputFile(
              config.models.configurationFile,
              false,
            ),
            upstreamEnvironmentFile: await inputFile(
              config.models.upstreamEnvironmentFile,
              true,
            ),
            image: release.images.models,
            port: models,
          },
          models: {
            configurationFile: join(
              path(config.stateDirectory),
              "private/models/native.json",
            ),
            runtimeKeyFile: join(
              path(config.stateDirectory),
              "private/models/runtime-key",
            ),
            caFile: join(
              path(config.stateDirectory),
              "private/management-ca.pem",
            ),
          },
        }
      : {}),
    ...(cloudConnections
      ? {
          connections: {
            mode: "external",
            brokerUrl: cloudConnections.brokerUrl,
            managementKeyFile: await inputFile(
              cloudConnections.managementKeyFile,
              true,
            ),
          },
        }
      : {}),
  });
  if (input.modelGateway)
    await loadGatewayConfiguration(
      input.modelGateway.configurationFile,
      input.modelGateway.upstreamEnvironmentFile,
    );
  else await loadInitialModels(input.models);
  await readTeamMaterials(input.team);
  await loadInitialConnections(input.connections);
  const connectorCredentialFile = cloudConnections
    ? await inputFile(cloudConnections.credentialFile, true)
    : undefined;
  if (connectorCredentialFile)
    await readInitialConnectionToken(connectorCredentialFile);
  const members = new Set<string>();
  const packs = [];
  for (const selected of config.packs) {
    const pack = await openPack(path(selected.directory));
    for (const id of selected.members) {
      const member = pack.manifest.members.find((m) => m.id === id);
      if (!member || members.has(id))
        throw new InstallationError(
          "invalid_configuration",
          "Pack member selections must exist and have unique agent IDs.",
        );
      members.add(id);
      if (
        member.requirements.connections.length &&
        (config.connections.mode === "disabled" || !selected.bindingsFile)
      )
        throw new InstallationError(
          "invalid_configuration",
          "This pack requires Connections and explicit account bindings.",
        );
    }
    const bindingsFile = selected.bindingsFile
      ? await inputFile(selected.bindingsFile, true)
      : undefined;
    inputs[`pack:${pack.root}`] = pack.digest;
    packs.push({
      directory: pack.root,
      digest: pack.digest,
      members: selected.members,
      ...(bindingsFile
        ? { bindingsFile, bindingsDigest: inputs[bindingsFile] }
        : {}),
    });
  }
  const packSelection = {
    packs,
    ...(config.packOperator
      ? { python: path(config.packOperator.pythonExecutable) }
      : {}),
  };
  return {
    config,
    release,
    input,
    stateDirectory: path(config.stateDirectory),
    connectorCredentialFile,
    packSelection,
    fingerprint: fingerprint(
      JSON.stringify({ config, release, inputs, releasePath }),
    ),
    internalPorts,
  };
}
