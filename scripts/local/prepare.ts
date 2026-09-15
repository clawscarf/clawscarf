import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import { composeConfiguration, compose, ensureOwnedVolume } from "./compose.js";
import { run, LocalSetupError } from "./process.js";

export async function prepareLocal(
  directoryInput: string,
  inputValue: unknown,
) {
  const directory = resolve(directoryInput);
  const input = parseLocalInput(inputValue);
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new LocalSetupError(
      "platform_unqualified",
      "This local assembly currently requires macOS arm64 with Docker Desktop; other platforms need qualification.",
    );
  for (const image of [input.runtimeImage, input.companionImage])
    await run("docker", ["image", "inspect", image]);
  const state = await initializeState(directory, input);
  await withLocalLock(directory, async () => {
    const privateDirectory = join(directory, "private");
    const names = resourceNames(state);
    await ensureOwnedVolume(names.databaseVolume, state.ownerId);
    await ensureOwnedVolume(names.volume, state.ownerId);
    await ensurePrivateFile(
      join(directory, "compose.json"),
      JSON.stringify(composeConfiguration(state, directory), null, 2),
    );
    await ensureCertificates(privateDirectory);
    await compose(directory, [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "90",
      "postgres",
    ]);
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
    });
    const pool = new pg.Pool({ connectionString: runtimeUrl });
    try {
      const store = new PostgresAccessStore(
        pool,
        await readFile(join(privateDirectory, "encryption.key")),
        {
          issuer: "urn:clawscarf:local",
          subject: "administrator",
          email: "administrator@localhost",
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
      const native = JSON.stringify(generated.native, null, 2);
      await initializeNativeVolume(state, native, identity.serverId);
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
      }),
    },
  );
}
