import { ensureOwnedVolume } from "./volumes.js";
import { prepareBrowserNode, browserNodeName } from "./browser-node.js";
import { withInitialServices } from "./initial-services.js";
import {
  loadInitialConnections,
  prepareInitialConnections,
  publishInitialConnections,
} from "./connections.js";
import { prepareRelay } from "./relay.js";
import { prepareRuntimePolicy } from "./policy.js";
import { prepareBrowser, initializeBrowserVolume } from "./browser.js";
import {
  prepareExecution,
  initializeExecutionVolume,
  type InitialExecution,
} from "./execution.js";
import { readTeamMaterials, prepareTeamFiles } from "./team.js";
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  prepareInitialModels,
  withInitialModels,
  type InitialModels,
} from "./models.js";
import { ensureLocalNetworks } from "./networks.js";
import { nodeEntrypoint } from "./entrypoint.js";
import { ensureCertificates } from "./certificates.js";
import pg from "pg";
import { z } from "zod";
import { PostgresAccessStore } from "../../services/access/repo/postgres.js";
import {
  parseLocalInput,
  generateLocalConfiguration,
} from "./configuration.js";
import { initializeLocalDatabase } from "./database.js";
import {
  initializeState,
  withLocalLock,
  writePrivate,
  ensurePrivateFile,
  resourceNames,
  type LocalState,
} from "./state.js";
import { composeConfiguration, compose } from "./compose.js";
import { run, LocalSetupError } from "./process.js";
import { verifyLocalExecutables, verifyLocalPorts } from "./preflight.js";
import { requireNoUpgrade } from "./upgrade-state.js";

export async function prepareLocal(
  directoryInput: string,
  inputValue: unknown,
) {
  const directory = resolve(directoryInput);
  const input = parseLocalInput(inputValue);
  const connections = await loadInitialConnections(input.connections);
  const teamMaterials = input.team
    ? await readTeamMaterials(input.team)
    : undefined;
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new LocalSetupError(
      "platform_unqualified",
      "This local assembly currently requires macOS arm64 with Docker Desktop; other platforms need qualification.",
    );
  for (const image of [
    input.runtimeImage,
    input.companionImage,
    ...(input.relayImage ? [input.relayImage] : []),
    ...(input.execution ? [input.execution.image] : []),
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
  const state = await initializeState(directory, input);
  await withLocalLock(directory, async () => {
    await requireNoUpgrade(directory);
    await verifyLocalExecutables(state);
    await verifyLocalPorts(state);
    const privateDirectory = join(directory, "private");
    await ensureCertificates(privateDirectory);
    const connectionsEndpoint = await prepareInitialConnections(
      directory,
      connections,
    );
    const models = await prepareInitialModels(directory, input.models);
    await prepareRuntimePolicy(
      directory,
      models,
      input.execution,
      connectionsEndpoint,
    );
    const execution = await prepareExecution(directory, state);
    await ensureLocalNetworks(directory, state);
    const browser = await prepareBrowser(directory, state);
    const browserMachine = browser
      ? await prepareBrowserNode(directory, state, browser.token)
      : undefined;
    const relayAddress = await prepareRelay(directory, state);
    const names = resourceNames(state);
    if (teamMaterials) await prepareTeamFiles(privateDirectory, teamMaterials);
    await ensureOwnedVolume(names.databaseVolume, state.ownerId);
    await ensureOwnedVolume(names.volume, state.ownerId);
    if (execution) {
      await ensureOwnedVolume(names.workerVolume, state.ownerId);
      await initializeExecutionVolume(state, execution);
    }
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
          browser?.address,
          relayAddress,
          browserMachine,
        ),
        null,
        2,
      ),
    );
    try {
      await compose(directory, [
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "90",
        "postgres",
      ]);
    } catch {
      throw new LocalSetupError(
        "database_start_failed",
        "PostgreSQL startup did not confirm success. Inspect this installation's Compose status/logs and Docker network address-pool capacity before retrying. Setup does not remove existing networks or volumes.",
      );
    }
    const adminUrl = new URL(
      `postgresql://postgres@127.0.0.1:${String(input.ports.database)}/clawscarf`,
    );
    adminUrl.password = await readFile(
      join(privateDirectory, "database-admin-password"),
      "utf8",
    );
    const { runtimeUrl } = await initializeLocalDatabase({
      adminUrl: adminUrl.toString(),
      runtimePassword: await readFile(
        join(privateDirectory, "database-runtime-password"),
        "utf8",
      ),
      ownerId: state.ownerId,
      connections: connections?.mode === "local",
    });
    if (connections?.mode === "local") {
      const operatorPool = new pg.Pool({
        connectionString: adminUrl.toString(),
      });
      try {
        await publishInitialConnections(operatorPool, connections);
      } finally {
        await operatorPool.end();
      }
    }
    const pool = new pg.Pool({ connectionString: runtimeUrl });
    try {
      const store = new PostgresAccessStore(
        pool,
        await readFile(join(privateDirectory, "encryption.key")),
        {
          issuer: input.team?.issuer ?? "urn:clawscarf:local",
          subject: input.team?.administratorSubject ?? "administrator",
          email: input.team?.administratorEmail ?? "administrator@localhost",
          name: input.administratorName,
        },
      );
      const identity = await store.initialize();
      const insideDatabase = new URL(runtimeUrl);
      insideDatabase.hostname = "postgres";
      insideDatabase.port = "5432";
      const generated = generateLocalConfiguration({
        input,
        directory: privateDirectory,
        encryptionKeyPath: join(privateDirectory, "encryption.key"),
        managementCertificatePath: join(
          privateDirectory,
          "management-cert.pem",
        ),
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
          execution: Boolean(input.execution),
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
        execution,
      );
      await writePrivate(
        join(directory, "identity.json"),
        JSON.stringify(identity, null, 2),
      );
    } finally {
      await pool.end();
    }
    const controller = join(directory, "controller");
    try {
      await lstat(controller);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
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
  });
  return state;
}

async function initializeNativeVolume(
  state: LocalState,
  configuration: string,
  serverId: string,
  modelCredential: InitialModels["credential"] | undefined,
  execution: InitialExecution | undefined,
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
        ...(execution
          ? {
              executionCredential: {
                clientKey: execution.clientKey,
                knownHosts: execution.knownHosts,
              },
            }
          : {}),
      }),
    },
  );
}
