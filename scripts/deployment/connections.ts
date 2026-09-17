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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type pg from "pg";
import { z } from "zod";
import { openConnectorCatalog } from "../../services/connections/providers/catalog/provider.js";
import { PostgresCatalogPublicationRepository } from "../../services/connections/repo/catalog-publication.js";
import { CatalogPublicationService } from "../../services/connections/service/catalog-publication.js";
import { CommonError } from "../../services/connections/shared/errors.js";
import type { ConnectorCatalog } from "../../services/connections/types/catalog.js";
import { networkRequirementSchema } from "../packs/policy.js";
import {
  connectionsBrokerUrlSchema,
  connectionsInputSchema,
  managementOrigin,
  type LocalInput,
} from "./configuration.js";
import { LocalSetupError } from "./process.js";
import {
  ensurePrivateFile,
  readState,
  writePrivate,
  type LocalState,
} from "./state.js";

interface InitialLocalConnections {
  mode: "local";
  projectId: string;
  apiKey: Buffer;
  catalogVersion: string;
  catalog: ConnectorCatalog;
  files: ReadonlyMap<string, Buffer>;
}
const maximumCertificateBytes = 64 * 1024;
const endpointSchema = z.strictObject({
  brokerUrl: connectionsBrokerUrlSchema,
  network: networkRequirementSchema,
  ca: z.string().min(1).max(maximumCertificateBytes).optional(),
});
export type InitialConnectionsEndpoint = z.infer<typeof endpointSchema>;
export type InitialConnections =
  | InitialLocalConnections
  | {
      mode: "external";
      endpoint: InitialConnectionsEndpoint;
    };

export async function readInitialConnectionToken(path: string) {
  return z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/u)
    .parse((await readRegular(path, true, 4096)).toString("utf8").trim());
}

const ownerSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    ownerId: z.uuid(),
    mode: z.literal("external"),
    endpointSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.strictObject({
    ownerId: z.uuid(),
    mode: z.literal("local"),
    endpointSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    projectId: z.string(),
    catalogVersion: z.string(),
  }),
]);

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
    "The retained Connections configuration differs from this installation's initial inputs. Setup will not replace endpoints, trust certificates, provider credentials or catalogs.",
  );
}
async function readRegular(
  path: string,
  privateFile: boolean,
  maximumBytes: number,
) {
  if (!(await lstat(path)).isFile())
    throw Error("Configuration must be a regular file");
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
      throw Error("Invalid configuration file");
    const bytes = await file.readFile();
    if (bytes.length > maximumBytes)
      throw Error("Configuration file exceeds its size limit");
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
    throw Error("Invalid configuration directory");
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
    else throw Error("Catalog entries must be regular files or directories");
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
  let staging: string | undefined;
  try {
    const checked = connectionsInputSchema.parse(input);
    if (checked.mode === "external") {
      const ca = checked.caFile
        ? new TextDecoder("utf8", { fatal: true }).decode(
            await readRegular(checked.caFile, false, maximumCertificateBytes),
          )
        : undefined;
      return { mode: "external", endpoint: endpoint(checked.brokerUrl, ca) };
    }
    const apiKey = await readRegular(checked.apiKeyFile, true, 65536);
    if (!apiKey.toString("utf8").trim()) throw Error("Empty API key");
    const files = await tree(checked.catalogDirectory, false);
    staging = await mkdtemp(join(tmpdir(), "clawscarf-catalog-"));
    await writeFiles(staging, files);
    const catalog = await openConnectorCatalog(staging, {
      verifyDetails: true,
    });
    return {
      mode: "local",
      projectId: checked.projectId,
      apiKey,
      catalogVersion: catalog.version,
      catalog,
      files,
    };
  } catch {
    throw new LocalSetupError(
      "invalid_connections_setup",
      "Check Connections setup inputs: local mode requires a private provider key, project ID and complete catalog; external mode requires an HTTPS DNS endpoint and, if supplied, a valid trust certificate. Configuration files cannot be symbolic links.",
    );
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
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
  if (
    loaded.mode === "local" &&
    (input.mode !== "local" || input.projectId !== loaded.projectId)
  )
    changed();
  if (
    loaded.mode === "external" &&
    (input.mode !== "external" ||
      endpoint(input.brokerUrl).brokerUrl !== loaded.endpoint.brokerUrl)
  )
    changed();
  const runtime =
    loaded.mode === "external"
      ? loaded.endpoint
      : endpoint(
          `${managementOrigin(state.input)}/_clawscarf/connections/v1`,
          (
            await readRegular(
              join(directory, "private/management-ca.pem"),
              true,
              maximumCertificateBytes,
            )
          ).toString("utf8"),
        );
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
          ...(loaded.mode === "local"
            ? {
                projectId: loaded.projectId,
                catalogVersion: loaded.catalogVersion,
              }
            : {}),
        }) + "\n",
      ),
    ],
    ["endpoint.json", endpointBytes],
  ]);
  if (loaded.mode === "local") {
    expected.set("api-key", loaded.apiKey);
    for (const [path, bytes] of loaded.files)
      expected.set("catalog/" + path, bytes);
  }
  const target = join(directory, "private/connections");
  try {
    await lstat(target);
    const retained = await tree(target, true);
    if (
      retained.size !== expected.size ||
      [...expected].some(
        ([path, bytes]) =>
          !(replacement && path === "api-key") &&
          !retained.get(path)?.equals(bytes),
      )
    )
      changed();
    if (replacement?.apply && loaded.mode === "local")
      await writePrivate(join(target, "api-key"), loaded.apiKey);
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
    if (loaded.mode === "local") {
      const copied = await openConnectorCatalog(join(staging, "catalog"), {
        verifyDetails: true,
      });
      if (copied.version !== loaded.catalogVersion) changed();
    }
    // Reserve the destination before rename so an existing foreign empty directory is never adopted.
    await mkdir(target, { mode: 0o700 });
    await rename(staging, target);
    return runtime;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Null is deliberate: initial setup may replay the same publication, never select a replacement version. */
export async function publishInitialConnections(
  pool: pg.Pool,
  loaded: InitialConnections | undefined,
): Promise<void> {
  if (!loaded || loaded.mode === "external") return;
  const service = new CatalogPublicationService(
    new PostgresCatalogPublicationRepository(pool),
  );
  try {
    const result = await service.publish(loaded.catalog, null);
    if (result.status === "blocked")
      throw new LocalSetupError(
        "connections_catalog_blocked",
        "Connections catalog publication is blocked by retained account or operation references. Initial setup will not retire them.",
      );
  } catch (error) {
    if (error instanceof CommonError && error.code === "revision_conflict")
      changed();
    throw error;
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
    if (owner.ownerId !== state.ownerId || owner.mode !== input.mode) changed();
    const expected =
      input.mode === "external"
        ? endpoint(input.brokerUrl, retained.ca)
        : endpoint(
            `${managementOrigin(state.input)}/_clawscarf/connections/v1`,
            (
              await readRegular(
                join(directory, "private/management-ca.pem"),
                true,
                maximumCertificateBytes,
              )
            ).toString("utf8"),
          );
    if (
      (input.mode === "external" &&
        Boolean(input.caFile) !== (retained.ca !== undefined)) ||
      (input.mode === "local" &&
        (owner.mode !== "local" || owner.projectId !== input.projectId)) ||
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
