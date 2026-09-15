import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
    additions.set(modelPath, await readFile(modelPath));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
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
  const target = join(bundles, `${digest}.pem`);
  const staged = join(bundles, `${randomUUID()}.tmp`);
  await writeFile(staged, combined, { flag: "wx", mode: 0o600 });
  try {
    await link(staged, target);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    if (
      !(await lstat(target)).isFile() ||
      !(await readFile(target)).equals(combined)
    )
      throw new Error(
        "The runtime CA bundle does not match its content digest.",
        { cause: error },
      );
  } finally {
    await rm(staged);
  }
  return target;
}
