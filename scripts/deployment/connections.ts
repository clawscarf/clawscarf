import { OperatorError } from "../errors.js";
import { constants } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { networkRequirementSchema } from "../packs/policy.js";
import {
  connectionsBrokerUrlSchema,
  connectionsInputSchema,
  type LocalInput,
} from "./configuration.js";
import { LocalSetupError } from "./process.js";
import { ensurePrivateFile, readState, type LocalState } from "./state.js";

const maximumCertificateBytes = 64 * 1024;
const endpointSchema = z.strictObject({
  brokerUrl: connectionsBrokerUrlSchema,
  network: networkRequirementSchema,
  ca: z.string().min(1).max(maximumCertificateBytes).optional(),
});
export type InitialConnectionsEndpoint = z.infer<typeof endpointSchema>;
export interface InitialConnections {
  mode: "external";
  endpoint: InitialConnectionsEndpoint;
  managementKey?: string;
}

export async function readInitialConnectionToken(path: string) {
  return z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/u)
    .parse((await readRegular(path, true, 4096)).toString("utf8").trim());
}

const ownerSchema = z.strictObject({
  ownerId: z.uuid(),
  mode: z.literal("external"),
  endpointSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

function endpoint(brokerUrl: string, ca?: string): InitialConnectionsEndpoint {
  const url = new URL(connectionsBrokerUrlSchema.parse(brokerUrl));
  if (ca !== undefined) new X509Certificate(ca);
  return endpointSchema.parse({
    brokerUrl: url.href.replace(/\/$/, ""),
    network: {
      host: url.hostname,
      port: Number(url.port || "443"),
      protocol: "tcp",
      binary: "/usr/local/bin/node",
    },
    ...(ca === undefined ? {} : { ca }),
  });
}
function changed(): never {
  throw new LocalSetupError(
    "configuration_changed",
    "The retained Connections configuration differs from this installation's initial inputs. Setup will not replace endpoints, trust certificates or management credentials.",
  );
}
async function readRegular(
  path: string,
  privateFile: boolean,
  maximumBytes: number,
) {
  if (!(await lstat(path)).isFile())
    throw new OperatorError("Configuration must be a regular file");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.size > maximumBytes ||
      (privateFile &&
        (metadata.uid !== process.getuid?.() ||
          metadata.nlink !== 1 ||
          (metadata.mode & 0o077) !== 0))
    )
      throw new OperatorError("Invalid configuration file");
    const bytes = await file.readFile();
    if (bytes.length > maximumBytes)
      throw new OperatorError("Configuration file exceeds its size limit");
    return bytes;
  } finally {
    await file.close();
  }
}
async function tree(
  directory: string,
  privateFiles: boolean,
  prefix = "",
): Promise<Map<string, Buffer>> {
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    (privateFiles &&
      (metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0))
  )
    throw new OperatorError("Invalid configuration directory");
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, bytes] of await tree(
        path,
        privateFiles,
        relative + "/",
      ))
        files.set(name, bytes);
    } else if (entry.isFile())
      files.set(
        relative,
        await readRegular(path, privateFiles, 128 * 1024 * 1024),
      );
    else
      throw new OperatorError(
        "Catalog entries must be regular files or directories",
      );
  }
  return files;
}
async function writeFiles(
  directory: string,
  files: ReadonlyMap<string, Buffer>,
) {
  for (const [name, bytes] of files) {
    const path = join(directory, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await ensurePrivateFile(path, bytes);
  }
}

/** Snapshot and verify optional input before installation resource allocation. No provider call is made. */
export async function loadInitialConnections(
  input: LocalInput["connections"],
): Promise<InitialConnections | undefined> {
  if (!input) return undefined;
  try {
    const checked = connectionsInputSchema.parse(input);
    const ca = checked.caFile
      ? new TextDecoder("utf8", { fatal: true }).decode(
          await readRegular(checked.caFile, false, maximumCertificateBytes),
        )
      : undefined;
    return {
      mode: "external",
      endpoint: endpoint(checked.brokerUrl, ca),
      ...(checked.managementKeyFile
        ? {
            managementKey: await readInitialConnectionToken(
              checked.managementKeyFile,
            ),
          }
        : {}),
    };
  } catch {
    throw new LocalSetupError(
      "invalid_connections_setup",
      "Connections requires an HTTPS DNS endpoint, a private management credential when supplied, and a valid trust certificate when supplied. Configuration files cannot be symbolic links.",
    );
  }
}

/** Caller holds the installation lock. A complete private snapshot is published once, never refreshed. */
export async function prepareInitialConnections(
  directory: string,
  loaded: InitialConnections | undefined,
  replacement?: { state: LocalState; apply: boolean },
): Promise<InitialConnectionsEndpoint | undefined> {
  if (!loaded) return;
  const state = replacement?.state ?? (await readState(directory));
  const input = state.input.connections;
  if (input?.mode !== loaded.mode) changed();
  if (input.brokerUrl.replace(/\/$/, "") !== loaded.endpoint.brokerUrl)
    changed();
  const runtime = loaded.endpoint;
  const endpointBytes = Buffer.from(JSON.stringify(runtime) + "\n");
  const expected = new Map<string, Buffer>([
    [
      "owner.json",
      Buffer.from(
        JSON.stringify({
          ownerId: state.ownerId,
          mode: loaded.mode,
          endpointSha256: createHash("sha256")
            .update(endpointBytes)
            .digest("hex"),
        }) + "\n",
      ),
    ],
    ["endpoint.json", endpointBytes],
  ]);
  if (loaded.managementKey)
    expected.set("management-key", Buffer.from(loaded.managementKey));
  const target = join(directory, "private/connections");
  try {
    await lstat(target);
    const retained = await tree(target, true);
    if (
      retained.size !== expected.size ||
      [...expected].some(([path, bytes]) => !retained.get(path)?.equals(bytes))
    )
      changed();
    return runtime;
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      "path" in error &&
      error.path === target
    ))
      changed();
  }
  if (replacement && !replacement.apply) return runtime;
  const staging = await mkdtemp(join(directory, "private/.connections-"));
  try {
    await writeFiles(staging, expected);
    // Reserve the destination before rename so an existing foreign empty directory is never adopted.
    await mkdir(target, { mode: 0o700 });
    await rename(staging, target);
    return runtime;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Read only retained public endpoint/trust material; never reads a provider or runtime credential. */
export async function readInitialConnectionsEndpoint(
  directory: string,
): Promise<InitialConnectionsEndpoint | undefined> {
  const state = await readState(directory);
  if (!state.input.connections) return undefined;
  try {
    const target = join(directory, "private/connections");
    for (const path of [join(directory, "private"), target]) {
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0
      )
        changed();
    }
    const owner = ownerSchema.parse(
      JSON.parse(
        (await readRegular(join(target, "owner.json"), true, 8192)).toString(
          "utf8",
        ),
      ),
    );
    const endpointBytes = await readRegular(
      join(target, "endpoint.json"),
      true,
      1024 * 1024,
    );
    if (
      createHash("sha256").update(endpointBytes).digest("hex") !==
      owner.endpointSha256
    )
      changed();
    const retained = endpointSchema.parse(
      JSON.parse(endpointBytes.toString("utf8")),
    );
    const input = state.input.connections;
    if (owner.ownerId !== state.ownerId) changed();
    const expected = endpoint(input.brokerUrl, retained.ca);
    if (
      Boolean(input.caFile) !== (retained.ca !== undefined) ||
      retained.brokerUrl !== expected.brokerUrl ||
      retained.ca !== expected.ca ||
      JSON.stringify(retained.network) !== JSON.stringify(expected.network)
    )
      changed();
    return retained;
  } catch {
    changed();
  }
}
