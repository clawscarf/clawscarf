import { hostedOidc } from "../cloud/registration.js";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { loadGatewayConfiguration } from "../deployment/model-gateway.js";
import { createServer } from "node:net";
import { releaseSchema } from "../release/definition.js";
import { verifyReleasePacks } from "../release/packs.js";
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

async function executable(path: string, checksum: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !(stat.mode & 0o111))
      throw new InstallationError(
        "release_mismatch",
        "A release tool is not an executable file.",
      );
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      if (!Buffer.isBuffer(chunk)) throw Error("Invalid file stream");
      hash.update(chunk);
    }
    if (hash.digest("hex") !== checksum)
      throw new InstallationError(
        "release_mismatch",
        "A release tool does not match its checksum.",
      );
  } finally {
    await file.close();
  }
}
export async function allocatePorts() {
  const servers = Array.from({ length: 8 }, () => createServer());
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
  await verifyReleasePacks(release, releasePath);
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
  const cli = resolve(toolBase, release.tools.openshell.cli.file);
  const gateway = resolve(toolBase, release.tools.openshell.gateway.file);
  await executable(cli, release.tools.openshell.cli.sha256);
  await executable(gateway, release.tools.openshell.gateway.sha256);
  const [
    controller,
    management,
    native,
    nativeWidgets,
    database,
    worker,
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
  const input: LocalInput = parseLocalInput({
    name: config.name,
    administratorName: access.administratorName,
    runtimeImage: release.images.gateway,
    companionImage: release.images.companion,
    relayImage: release.images.relay,
    openshellCli: cli,
    openshellGateway: gateway,
    openshellClientImage: release.images.openshellClient,
    cpu: config.resources.gateway.cpu,
    memory: config.resources.gateway.memory,
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
    execution: {
      image: release.images.worker,
      port: worker,
      ...config.resources.worker,
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
    ...(config.connections.mode === "local"
      ? {
          connections: {
            mode: "local",
            projectId: config.connections.projectId,
            apiKeyFile: await inputFile(config.connections.apiKeyFile, true),
            catalogDirectory: path(config.connections.catalogDirectory),
          },
        }
      : {}),
    ...(config.connections.mode === "external"
      ? {
          connections: {
            mode: "external",
            brokerUrl: config.connections.brokerUrl,
            ...(config.connections.caFile
              ? { caFile: await inputFile(config.connections.caFile, false) }
              : {}),
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
  if (input.team) await readTeamMaterials(input.team);
  const connections = await loadInitialConnections(input.connections);
  if (connections?.mode === "local")
    for (const [name, bytes] of connections.files)
      inputs[`catalog:${name}`] = fingerprint(bytes);
  const connectorCredentialFile =
    config.connections.mode === "external"
      ? await inputFile(config.connections.credentialFile, true)
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
