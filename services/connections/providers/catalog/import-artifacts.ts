import { canonicalJson } from "../../shared/json.js";
import {
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ConnectorActionDetail,
  ConnectorJson,
} from "../../types/catalog.js";
import {
  connectorActionSummary,
  catalogDigest,
  parseCatalogJson,
  type ConnectorCatalogIndex,
  type ConnectorManifest,
  type ConnectorManifestEntry,
} from "./artifact.js";
import { connectorFilePaths } from "./file-markers.js";
import { readCatalogFile } from "./files.js";
import {
  readCatalogDetail,
  readCatalogIndex,
  readConnectorManifest,
} from "./validation.js";

export function buildConnectorCatalog(
  manifest: ConnectorManifest,
  sources: ReadonlyMap<string, ConnectorJson[]>,
): Map<string, string> {
  readConnectorManifest(manifest);
  const files = new Map<string, string>();
  const entries: ConnectorCatalogIndex["connectors"] = [];
  for (const connector of [...manifest.connectors].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const source = sources.get(connector.id);
    if (!source)
      throw Error(`Raw catalog source is missing for ${connector.id}.`);
    const actions = source
      .map((raw) => projectAction(connector, raw))
      .filter((value) => value !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!actions.length)
      throw Error(`Catalog contains no active actions for ${connector.id}.`);
    const detail = readCatalogDetail({ connectorId: connector.id, actions });
    files.set(`${connector.id}.json`, `${canonicalJson(detail)}\n`);
    files.set(`raw/${connector.id}.json`, `${canonicalJson(source)}\n`);
    entries.push({
      metadata: connector,
      actions: actions.map(connectorActionSummary),
      detailDigest: catalogDigest(detail),
      sourceDigest: catalogDigest(source),
    });
  }
  const content = {
    manifestDigest: catalogDigest(manifest),
    connectors: entries,
  };
  const index = readCatalogIndex({
    ...content,
    version: catalogDigest(content),
  });
  files.set("index.json", `${canonicalJson(index)}\n`);
  return files;
}

function projectAction(
  connector: ConnectorManifestEntry,
  raw: ConnectorJson,
): ConnectorActionDetail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Catalog action must be an object.");
  if (raw.is_deprecated === true) return null;
  const toolkit = raw.toolkit;
  if (
    toolkit &&
    typeof toolkit === "object" &&
    !Array.isArray(toolkit) &&
    toolkit.slug !== undefined &&
    toolkit.slug !== connector.toolkitSlug
  )
    throw Error("Catalog action belongs to a different toolkit.");
  const id = requiredText(raw.slug);
  const inputSchema = parseCatalogJson(
    raw.input_parameters ?? null,
    2 * 1024 * 1024,
  );
  const outputSchema = parseCatalogJson(
    raw.output_parameters ?? null,
    2 * 1024 * 1024,
  );
  return {
    id,
    connectorId: connector.id,
    name: optionalText(raw.name) ?? id,
    description:
      optionalText(raw.human_description) ??
      optionalText(raw.description) ??
      optionalText(raw.name) ??
      id,
    version: requiredText(raw.version),
    schemaDigest: catalogDigest({ inputSchema, outputSchema }),
    inputSchema,
    outputSchema,
    fileInputs: connectorFilePaths(inputSchema, "file_uploadable"),
    fileOutputs: connectorFilePaths(outputSchema, "file_downloadable"),
  };
}

function requiredText(value: ConnectorJson | undefined): string {
  const result = optionalText(value);
  if (result === null)
    throw Error("Catalog action is missing its exact identity or version.");
  return result;
}
function optionalText(value: ConnectorJson | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function readJsonFile(
  path: string,
  maximumBytes = 128 * 1024 * 1024,
): Promise<unknown> {
  return readCatalogFile(path, maximumBytes);
}

export async function readRawCatalog(
  directory: string,
  manifest: ConnectorManifest,
): Promise<Map<string, ConnectorJson[]>> {
  const sources = new Map<string, ConnectorJson[]>();
  for (const entry of manifest.connectors) {
    const raw = parseCatalogJson(
      await readJsonFile(join(directory, `${entry.id}.json`)),
      128 * 1024 * 1024,
    );
    if (!Array.isArray(raw))
      throw Error("Raw catalog snapshot must be an action array.");
    sources.set(entry.id, raw);
  }
  return sources;
}

export async function catalogDifference(
  directory: string,
  files: ReadonlyMap<string, string>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const [path, bytes] of files) {
    let existing: string | null = null;
    try {
      existing = await readFile(join(directory, path), "utf8");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (existing !== bytes) changed.push(path);
  }
  const existingPaths = await generatedPaths(directory);
  for (const path of existingPaths)
    if (!files.has(path)) changed.push(`removed:${path}`);
  return changed.sort();
}

async function generatedPaths(
  directory: string,
  prefix = "",
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      paths.push(
        ...(await generatedPaths(join(directory, entry.name), `${relative}/`)),
      );
    else paths.push(relative);
  }
  return paths;
}

/** Stage the complete import before replacing the generated directory. */
export async function writeCatalog(
  directory: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  await mkdir(dirname(directory), { recursive: true });
  const stage = await mkdtemp(
    join(dirname(directory), `.${basename(directory)}-`),
  );
  const previous = `${stage}-previous`;
  let moved = false;
  try {
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), bytes);
    }
    try {
      await rename(directory, previous);
      moved = true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    try {
      await rename(stage, directory);
    } catch (error) {
      if (moved) await rename(previous, directory);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
