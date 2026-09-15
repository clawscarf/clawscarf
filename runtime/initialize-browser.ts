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
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

export class BrowserInitializationError extends Error {
  readonly code = "browser_state_conflict";
}

function missing(error: unknown, path: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    "path" in error &&
    error.path === path
  );
}

/** Initialize a fresh, exclusively mounted profile volume; resume only with identical private identity. */
export async function initializeBrowserState(
  state: string,
  value: unknown,
  uid: number,
  gid: number,
): Promise<void> {
  const input = inputSchema.parse(value);
  try {
    await mkdir(state, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const home = await lstat(state);
  if (!home.isDirectory())
    throw new BrowserInitializationError(
      "Browser state must be a directory, not a symbolic link.",
    );
  const target = join(state, ".clawscarf-browser");
  const files = {
    "owner.json": JSON.stringify({ ownerId: input.ownerId }),
    token: input.token,
  };
  let exists = true;
  try {
    const metadata = await lstat(target);
    if (
      !metadata.isDirectory() ||
      (metadata.mode & 0o777) !== 0o700 ||
      metadata.uid !== uid ||
      metadata.gid !== gid
    )
      throw new BrowserInitializationError(
        "Browser identity directory has unsafe ownership or permissions.",
      );
  } catch (error) {
    if (!missing(error, target)) throw error;
    exists = false;
  }
  if (exists) {
    if ((home.mode & 0o777) !== 0o700 || home.uid !== uid || home.gid !== gid)
      throw new BrowserInitializationError(
        "Browser volume has unsafe ownership or permissions.",
      );
    for (const [name, content] of Object.entries(files)) {
      const path = join(target, name);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        (metadata.mode & 0o777) !== 0o600 ||
        metadata.uid !== uid ||
        metadata.gid !== gid ||
        (await readFile(path, "utf8")) !== content
      )
        throw new BrowserInitializationError(
          "Browser identity or token differs; initialization will not replace it.",
        );
    }
    return;
  }
  if ((await readdir(state)).length !== 0)
    throw new BrowserInitializationError(
      "Browser volume already contains unowned data.",
    );
  const staging = await mkdtemp(join(state, ".clawscarf-bootstrap-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(staging, name);
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
      await chown(path, uid, gid);
    }
    await chown(staging, uid, gid);
    await chmod(state, 0o700);
    await chown(state, uid, gid);
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
