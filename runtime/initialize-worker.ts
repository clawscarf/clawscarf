import {
  chmod,
  chown,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const inputSchema = z.strictObject({
  ownerId: z.uuid(),
  hostKey: z
    .string()
    .startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n")
    .max(8192),
  authorizedKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}\n$/),
});

/** Populate only a fresh owned worker home. Resume verifies identity without replacing data or keys. */
export async function initializeWorkerHome(
  home: string,
  value: unknown,
  uid: number,
  gid: number,
) {
  const input = inputSchema.parse(value);
  const target = join(home, ".clawscarf-worker");
  const files = {
    "owner.json": JSON.stringify({ ownerId: input.ownerId }),
    host_ed25519: input.hostKey,
    authorized_keys: input.authorizedKey,
  };
  try {
    const state = await lstat(target);
    const retainedHome = await lstat(home);
    if (
      !state.isDirectory() ||
      state.uid !== uid ||
      state.gid !== gid ||
      (state.mode & 0o077) !== 0 ||
      !retainedHome.isDirectory() ||
      retainedHome.uid !== uid ||
      retainedHome.gid !== gid ||
      (retainedHome.mode & 0o022) !== 0
    )
      throw Error(
        "Worker home and credential directory require their original ownership and safe permissions.",
      );
    for (const [name, content] of Object.entries(files)) {
      const path = join(target, name);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        (metadata.mode & 0o077) !== 0 ||
        metadata.uid !== uid ||
        metadata.gid !== gid ||
        (await readFile(path, "utf8")) !== content
      )
        throw Error(
          "Worker identity or credentials differ; initialization will not replace them.",
        );
    }
    return;
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
  if (!(await lstat(home)).isDirectory())
    throw Error("The worker home must be a directory, not a symbolic link.");
  if (
    (await readdir(home)).some(
      (name) => !name.startsWith(".clawscarf-bootstrap-"),
    )
  )
    throw Error("The worker home already contains unowned data.");
  await chmod(home, 0o700);
  const staging = await mkdtemp(join(home, ".clawscarf-bootstrap-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(staging, name);
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
      await chown(path, uid, gid);
    }
    await chown(staging, uid, gid);
    await chown(home, uid, gid);
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
