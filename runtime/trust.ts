import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  isMissingFile,
  privateDirectory,
  readPrivateFile,
} from "./private-files.js";
import { loadConnectionsCredential } from "./connections-credential.js";

/** Retain controller/operator trust alongside optional model and Connections CAs. */
export async function runtimeTrust(
  stateDirectory: string,
  inherited: string | undefined,
): Promise<string | undefined> {
  const connections = await loadConnectionsCredential(stateDirectory);
  const modelPath = join(stateDirectory, "clawscarf-models", "ca.pem");
  const additions = new Map<string, Buffer>();
  try {
    await privateDirectory(dirname(modelPath));
    additions.set(modelPath, await readPrivateFile(modelPath));
  } catch (error) {
    if (
      !isMissingFile(error, modelPath) &&
      !isMissingFile(error, dirname(modelPath))
    )
      throw error;
  }
  if (connections?.ca && connections.caPath)
    additions.set(connections.caPath, connections.ca);
  if (!additions.size) return inherited;
  const first = additions.keys().next().value;
  if (!first) throw new Error("Runtime trust has no certificate source.");
  if (additions.size === 1 && (!inherited || additions.has(inherited)))
    return first;
  const sources = new Map(additions);
  if (inherited && !sources.has(inherited))
    sources.set(inherited, await readFile(inherited));
  const combined = Buffer.concat(
    [...sources.values()].flatMap((bytes) => [bytes, Buffer.from("\n")]),
  );
  const digest = createHash("sha256").update(combined).digest("hex");
  const bundles = join(dirname(first), "trust");
  await mkdir(bundles, { recursive: true, mode: 0o700 });
  await privateDirectory(bundles);
  const target = join(bundles, `${digest}.pem`);
  try {
    if (!(await readPrivateFile(target, combined.length)).equals(combined))
      throw new Error(
        "The runtime CA bundle does not match its content digest.",
      );
    return target;
  } catch (error) {
    if (!isMissingFile(error, target)) throw error;
  }
  const staged = join(bundles, `${randomUUID()}.tmp`);
  try {
    await writeFile(staged, combined, { flag: "wx", mode: 0o600 });
    // Concurrent publishers of this digest write identical bytes; rename exposes a single-link file.
    await rename(staged, target);
  } finally {
    await rm(staged, { force: true });
  }
  return target;
}
