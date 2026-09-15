import {
  chown,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const inputSchema = z.strictObject({
  ownerId: z.uuid(),
  serverId: z.uuid(),
  configuration: z.string().min(1),
});
/** Initialization only: never overwrite native edits in an already-owned volume. */
export async function initializeHome(
  home: string,
  value: unknown,
  uid: number,
  gid: number,
) {
  const input = inputSchema.parse(value);
  const target = join(home, ".openclaw");
  const marker = "clawscarf-installation.json";
  try {
    const metadata = await lstat(target);
    if (!metadata.isDirectory())
      throw Error("Native state must be a directory.");
    const entries = await readdir(target);
    if (entries.length) {
      z.strictObject({
        ownerId: z.literal(input.ownerId),
        serverId: z.literal(input.serverId),
      }).parse(JSON.parse(await readFile(join(target, marker), "utf8")));
      if (!(await lstat(join(target, "openclaw.json"))).isFile())
        throw Error("Owned state has missing native configuration.");
      return;
    }
    await rmdir(target);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      "path" in error &&
      error.path === target
    ))
      throw error;
  }
  await mkdir(home, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(home, ".clawscarf-bootstrap-"));
  try {
    await writeFile(join(staging, "openclaw.json"), input.configuration, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      join(staging, marker),
      JSON.stringify({ ownerId: input.ownerId, serverId: input.serverId }),
      { flag: "wx", mode: 0o600 },
    );
    for (const path of [
      home,
      staging,
      join(staging, "openclaw.json"),
      join(staging, marker),
    ])
      await chown(path, uid, gid);
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
