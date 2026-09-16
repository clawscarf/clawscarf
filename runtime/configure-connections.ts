import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { loadConnectionsCredential } from "./connections-credential.js";
import {
  connectionsConfigurationInputSchema,
  connectionsConfigurationResultSchema,
  nativeConnectionsConfigurationResultSchema,
  type ConnectionsConfigurationInput,
  type ConnectionsConfigurationResult,
} from "./connections-configuration.js";

import {
  isMissingFile,
  privateDirectory,
  readPrivateFile,
} from "./private-files.js";
export class ConnectionsConfigurationError extends Error {
  constructor(
    readonly code:
      | "connections_configuration_invalid"
      | "connections_configuration_incomplete",
  ) {
    super(
      code === "connections_configuration_incomplete"
        ? "Connections configuration may be partially applied. Observe the retained state before an explicit retry."
        : "Connections configuration could not be validated. Check the owned private state and inputs.",
    );
  }
}
const packageDirectory = "/app/clawscarf/connections";
interface NativeRequest {
  kind: "configure" | "observe";
  brokerUrl: string;
  packageDirectory: typeof packageDirectory;
  replacePackageDirectories: readonly string[];
}
type NativeCommand = (
  request: NativeRequest,
  stateDirectory: string,
) => Promise<unknown>;
const execute = promisify(execFile);
const nativeCommand: NativeCommand = async (request, stateDirectory) => {
  const child = execute(
    process.execPath,
    [join(packageDirectory, "dist/configuration-command.js")],
    {
      env: {
        ...process.env,
        HOME: dirname(stateDirectory),
        OPENCLAW_STATE_DIR: stateDirectory,
        OPENCLAW_CONFIG_PATH: join(stateDirectory, "openclaw.json"),
        SQLITE_TMPDIR: "/tmp",
      },
      timeout: 45_000,
      maxBuffer: 64 * 1024,
    },
  );
  child.child.stdin?.end(JSON.stringify(request));
  const result = await child;
  return JSON.parse(result.stdout) as unknown;
};
async function optionalFile(path: string) {
  try {
    return await readPrivateFile(path);
  } catch (error) {
    if (!isMissingFile(error, path)) throw error;
  }
}
async function replaceFile(path: string, value: string) {
  const staged = path + "." + randomUUID();
  try {
    await writeFile(staged, value, { flag: "wx", mode: 0o600 });
    // Caller owns the stopped volume exclusively; recheck any retained destination before replacement.
    await optionalFile(path);
    await rename(staged, path);
  } finally {
    await rm(staged, { force: true });
  }
}
async function credentialMatches(
  stateDirectory: string,
  credential: NonNullable<ConnectionsConfigurationInput["credential"]>,
) {
  const retained = await loadConnectionsCredential(stateDirectory);
  return (
    retained !== undefined &&
    retained.token === credential.token &&
    retained.ca?.toString("utf8") === credential.ca
  );
}

/** Caller owns the operator lock and stopped volume. Individual file writes and native mutation are not one transaction. */
export async function configureRuntimeConnections(
  home: string,
  value: unknown,
  command: NativeCommand = nativeCommand,
): Promise<ConnectionsConfigurationResult> {
  let effectsStarted = false;
  try {
    const input = connectionsConfigurationInputSchema.parse(value);
    const stateDirectory = join(home, ".openclaw");
    await privateDirectory(home);
    await privateDirectory(stateDirectory);
    z.strictObject({
      ownerId: z.literal(input.ownerId),
      serverId: z.literal(input.serverId),
    }).parse(
      JSON.parse(
        (
          await readPrivateFile(
            join(stateDirectory, "clawscarf-installation.json"),
          )
        ).toString("utf8"),
      ),
    );
    // Native SDK owns configuration semantics; this check protects the file boundary before invoking it.
    await readPrivateFile(join(stateDirectory, "openclaw.json"));
    const directory = join(stateDirectory, "clawscarf-connections");
    let directoryExists = true;
    try {
      await privateDirectory(directory);
    } catch (error) {
      if (!isMissingFile(error, directory)) throw error;
      directoryExists = false;
    }
    const credentialPath = join(directory, "runtime.json");
    const caPath = join(directory, "ca.pem");
    const oldCredential = directoryExists
      ? await optionalFile(credentialPath)
      : undefined;
    const oldCa = directoryExists ? await optionalFile(caPath) : undefined;
    const request: NativeRequest = {
      kind: input.kind,
      brokerUrl: input.brokerUrl,
      packageDirectory,
      replacePackageDirectories: [],
    };
    if (input.kind === "configure") {
      const credential = input.credential;
      if (!credential) throw new Error("A credential is required.");
      effectsStarted = true;
      if (!directoryExists) await mkdir(directory, { mode: 0o700 });
      const serialized = JSON.stringify({ token: credential.token }) + "\n";
      if (oldCredential?.toString("utf8") !== serialized)
        await replaceFile(credentialPath, serialized);
      if (credential.ca !== undefined) {
        if (oldCa?.toString("utf8") !== credential.ca)
          await replaceFile(caPath, credential.ca);
      } else if (oldCa !== undefined) {
        await readPrivateFile(caPath);
        await rm(caPath);
      }
    }
    const native = nativeConnectionsConfigurationResultSchema.parse(
      await command(request, stateDirectory),
    );
    // Validate retained material even if observation has no expected credential to compare.
    await loadConnectionsCredential(stateDirectory);
    const matches = input.credential
      ? await credentialMatches(stateDirectory, input.credential)
      : undefined;
    if (
      input.kind === "configure" &&
      (native.state !== "configured" ||
        native.brokerUrl !==
          new URL(input.brokerUrl).href.replace(/\/$/u, "") ||
        matches !== true)
    )
      throw new Error(
        "Connections configuration did not match after delivery.",
      );
    return connectionsConfigurationResultSchema.parse({
      ...native,
      ...(matches === undefined ? {} : { credentialMatches: matches }),
    });
  } catch {
    throw new ConnectionsConfigurationError(
      effectsStarted
        ? "connections_configuration_incomplete"
        : "connections_configuration_invalid",
    );
  }
}
