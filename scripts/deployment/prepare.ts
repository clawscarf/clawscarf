import { openshellGatewayImage, verifyRuntimeImage } from "./images.js";
import { ensureOwnedVolume } from "./volumes.js";
import {
  prepareModelGateway,
  prepareModelCredential,
} from "./model-gateway.js";
import { prepareBrowserNode, browserNodeName } from "./browser-node.js";
import { withInitialServices } from "./initial-services.js";
import {
  loadInitialConnections,
  prepareInitialConnections,
  readInitialConnectionToken,
} from "./connections.js";
import { prepareRelay } from "./relay.js";
import { prepareRuntimePolicy } from "./policy.js";
import { prepareBrowser, initializeBrowserVolume } from "./browser.js";
import { readTeamMaterials, prepareTeamFiles } from "./team.js";
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  prepareInitialModels,
  withInitialModels,
  type InitialModels,
} from "./models.js";
import { ensureLocalNetworks, observedControllerAddress } from "./networks.js";
import { nodeEntrypoint } from "./entrypoint.js";
import { ensureCertificates } from "./certificates.js";
import { z } from "zod";
import { PostgresAccessStore } from "../../services/access/repo/postgres.js";
import {
  parseLocalInput,
  generateLocalConfiguration,
} from "./configuration.js";
import { withPreparedDatabase } from "./database.js";
import {
  initializeState,
  writePrivate,
  ensurePrivateFile,
  resourceNames,
  type LocalState,
} from "./state.js";
import { composeConfiguration } from "./compose.js";
import { run, LocalSetupError } from "./process.js";
import { verifyLocalExecutables, verifyLocalPorts } from "./preflight.js";
import { requireNoUpgrade } from "./upgrade-state.js";

/** Internal operation: the caller holds the installation lock for its full lifetime. */
export async function prepareLocal(
  directoryInput: string,
  inputValue: unknown,
  capabilities?: {
    inputFingerprint: string;
    connections?: { credentialFile?: string };
  },
) {
  const directory = resolve(directoryInput);
  const input = parseLocalInput(inputValue);
  const connections = await loadInitialConnections(input.connections);
  const teamMaterials = await readTeamMaterials(input.team);
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !["arm64", "x64"].includes(process.arch)
  )
    throw new LocalSetupError(
      "platform_unqualified",
      "Use macOS or Linux (including WSL2) with Linux Docker containers.",
    );
  for (const image of [
    input.runtimeImage,
    input.openshellClientImage,
    openshellGatewayImage,
    input.companionImage,
    ...(input.modelGateway ? [input.modelGateway.image] : []),
    ...(input.relayImage ? [input.relayImage] : []),
    ...(input.browser
      ? [
          input.browser.image,
          input.browser.egressImage,
          input.browser.nodeImage,
          input.browser.dnsImage,
        ]
      : []),
  ])
    await run("docker", ["image", "inspect", image]);
  await verifyRuntimeImage(input.runtimeImage);
  const state = await initializeState(directory, input);
  try {
    z.strictObject({
      ownerId: z.literal(state.ownerId),
      settingsCandidate: z.string().optional(),
      settingsReapply: z.enum(["models", "connections"]).optional(),
    }).parse(
      JSON.parse(await readFile(join(directory, "prepared.json"), "utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new LocalSetupError(
        "configuration_changed",
        "A retained settings change is unconfirmed. Inspect it before preparing or starting this installation.",
      );
  }
  await requireNoUpgrade(directory);
  if (capabilities)
    await ensurePrivateFile(
      join(directory, "inputs.sha256"),
      capabilities.inputFingerprint,
    );
  await verifyLocalExecutables(state);
  await verifyLocalPorts(state);
  const privateDirectory = join(directory, "private");
  await ensureCertificates(privateDirectory);
  const connectionsEndpoint = await prepareInitialConnections(
    directory,
    connections,
  );
  await prepareModelGateway(directory, state);
  await ensureLocalNetworks(directory, state);
  const controllerAddress = await observedControllerAddress(directory, state);
  const browser = await prepareBrowser(directory, state);
  const browserMachine = browser
    ? await prepareBrowserNode(directory, state, browser.token)
    : undefined;
  await prepareRelay(directory, state);
  const names = resourceNames(state);
  await prepareTeamFiles(privateDirectory, teamMaterials);
  await ensureOwnedVolume(names.databaseVolume, state.ownerId);
  await ensureOwnedVolume(names.volume, state.ownerId);
  if (input.modelGateway)
    await ensureOwnedVolume(`${names.project}-models`, state.ownerId);
  if (browser) {
    await ensureOwnedVolume(names.browserVolume, state.ownerId);
    await initializeBrowserVolume(state, browser.token);
  }
  await ensurePrivateFile(
    join(directory, "compose.json"),
    JSON.stringify(
      composeConfiguration(
        state,
        directory,
        controllerAddress,
        browser?.address,
        browserMachine,
      ),
      null,
      2,
    ),
  );
  await prepareModelCredential(directory, state);
  const models = await prepareInitialModels(directory, input.models);
  await prepareRuntimePolicy(directory, models, connectionsEndpoint);
  await withPreparedDatabase(directory, state, async (pool, runtimeUrl) => {
    const store = new PostgresAccessStore(
      pool,
      await readFile(join(privateDirectory, "encryption.key")),
      {
        issuer: input.team.issuer,
        subject: input.team.administratorSubject ?? "urn:clawscarf:unclaimed",
        email: input.team.administratorEmail ?? "",
        claimRequired: !input.team.administratorSubject,
        name: input.administratorName,
      },
    );
    const identity = await store.initialize();
    const connectionCredential =
      capabilities?.connections && connectionsEndpoint
        ? {
            ...connectionsEndpoint,
            token: await readInitialConnectionToken(
              capabilities.connections.credentialFile ?? "",
            ),
          }
        : undefined;
    const insideDatabase = new URL(runtimeUrl);
    insideDatabase.hostname = "postgres";
    insideDatabase.port = "5432";
    const generated = generateLocalConfiguration({
      input,
      directory: privateDirectory,
      encryptionKeyPath: join(privateDirectory, "encryption.key"),
      managementCertificatePath: join(privateDirectory, "management-cert.pem"),
      managementKeyPath: join(privateDirectory, "management-key.pem"),
      runtimeDatabaseUrl: insideDatabase.toString(),
      administratorIdentity: identity.administrator.identity,
    });
    // Native configuration is an initialization input; it is never re-applied on resume.
    await ensurePrivateFile(
      join(privateDirectory, "access.json"),
      JSON.stringify(generated.access, null, 2),
    );
    await ensurePrivateFile(
      join(privateDirectory, "companion.json"),
      JSON.stringify(generated.companion, null, 2),
    );
    const configured = withInitialModels(generated.native, models);
    const native = JSON.stringify(
      withInitialServices(configured, {
        ...(connectionCredential
          ? { connectionsBrokerUrl: connectionCredential.brokerUrl }
          : {}),
        ...(browser
          ? {
              browserToken: browser.token,
              browserNode: browserNodeName(state),
            }
          : {}),
      }),
      null,
      2,
    );
    await initializeNativeVolume(
      state,
      native,
      identity.serverId,
      models?.credential,
      connectionCredential,
    );
    await writePrivate(
      join(directory, "identity.json"),
      JSON.stringify(identity, null, 2),
    );
  });
  const controller = join(directory, "controller");
  try {
    await lstat(controller);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await run(process.execPath, [
      ...nodeEntrypoint("../controller"),
      "init",
      "--directory",
      controller,
      "--gateway",
      input.openshellGateway,
      "--cli",
      input.openshellCli,
      "--host-gateway-ip",
      controllerAddress,
      "--name",
      names.sandbox,
      "--port",
      String(input.ports.controller),
    ]);
  }
  // The existing helper owns controller configuration; partial initialization must be explicit.
  z.object({
    name: z.literal(names.sandbox),
    port: z.literal(input.ports.controller),
    cli: z.literal(input.openshellCli),
    gateway: z.literal(input.openshellGateway),
  }).parse(
    JSON.parse(await readFile(join(controller, "controller.json"), "utf8")),
  );
  await writePrivate(
    join(directory, "prepared.json"),
    JSON.stringify({ ownerId: state.ownerId }),
  );
  return state;
}

async function initializeNativeVolume(
  state: LocalState,
  configuration: string,
  serverId: string,
  modelCredential: InitialModels["credential"] | undefined,
  connectionsCredential?: { token: string; ca?: string | undefined },
) {
  await run(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--pull",
      "never",
      "--network",
      "none",
      "--user",
      "root",
      "--mount",
      `type=volume,source=${resourceNames(state).volume},target=/home/node,volume-nocopy`,
      "--entrypoint",
      "node",
      state.input.runtimeImage,
      "/app/clawscarf/initialize-main.js",
    ],
    {
      input: JSON.stringify({
        ownerId: state.ownerId,
        serverId,
        configuration,
        ...(modelCredential ? { modelCredential } : {}),
        ...(connectionsCredential
          ? {
              connectionsCredential: {
                token: connectionsCredential.token,
                ...(connectionsCredential.ca
                  ? { ca: connectionsCredential.ca }
                  : {}),
              },
            }
          : {}),
      }),
    },
  );
}
