import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { packSchema } from "./model.js";
export async function openPack(directory: string) {
  const root = await realpath(directory);
  const manifest = packSchema.parse(
    JSON.parse(await readFile(join(root, "pack.json"), "utf8")),
  );
  if (
    new Set(manifest.members.map((item) => item.id)).size !==
    manifest.members.length
  )
    throw Error("Pack member IDs must be unique.");
  for (const member of manifest.members) {
    const source = await realpath(resolve(root, member.source));
    if (!source.startsWith(root + sep))
      throw Error("Claw source must remain inside its pack.");
  }
  const digest = createHash("sha256");
  let size = 0;
  async function visit(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      (metadata.nlink > 1 && !metadata.isDirectory())
    )
      throw Error("Pack sources cannot use linked files.");
    if (metadata.isDirectory()) {
      for (const item of (await readdir(path)).sort())
        await visit(join(path, item));
      return;
    }
    if (!metadata.isFile() || (size += metadata.size) > 8 * 1024 * 1024)
      throw Error(
        "Pack source exceeds the 8 MiB limit or is not a regular file.",
      );
    digest.update(relative(root, path));
    digest.update("\0");
    digest.update(await readFile(path));
    digest.update("\0");
  }
  await visit(root);
  return { root, manifest, digest: "sha256:" + digest.digest("hex") };
}
