import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Retain controller/operator CA trust when adding a private model gateway. */
export async function runtimeTrust(
  stateDirectory: string,
  inherited: string | undefined,
): Promise<string> {
  const directory = join(stateDirectory, "clawscarf-models");
  const modelPath = join(directory, "ca.pem");
  const model = await readFile(modelPath);
  if (!inherited || inherited === modelPath) return modelPath;
  const combined = Buffer.concat([
    await readFile(inherited),
    Buffer.from("\n"),
    model,
    Buffer.from("\n"),
  ]);
  const digest = createHash("sha256").update(combined).digest("hex");
  const bundles = join(directory, "trust");
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
