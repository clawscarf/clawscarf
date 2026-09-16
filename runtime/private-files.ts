import { constants, type Stats } from "node:fs";
import {
  chown,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export function isMissingFile(error: unknown, path: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    "path" in error &&
    error.path === path
  );
}

interface Ownership {
  uid?: number;
  gid?: number;
  mode?: number;
}

export async function privateDirectory(path: string, owner: Ownership = {}) {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== (owner.uid ?? process.getuid?.()) ||
    (owner.gid !== undefined && metadata.gid !== owner.gid) ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error("Unsafe private directory.");
}

export function assertPrivateFile(
  metadata: Stats,
  owner: Ownership = {},
): void {
  if (
    !metadata.isFile() ||
    metadata.uid !== (owner.uid ?? process.getuid?.()) ||
    (owner.gid !== undefined && metadata.gid !== owner.gid) ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o077) !== 0 ||
    (owner.mode !== undefined && (metadata.mode & 0o777) !== owner.mode)
  )
    throw new Error("Unsafe private file.");
}

/** Read through one descriptor; reject links, other owners and growth beyond the bound. */
export async function readPrivateFile(
  path: string,
  maximumBytes = 1024 * 1024,
  owner: Ownership = {},
): Promise<Buffer> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await file.stat();
    assertPrivateFile(metadata, owner);
    if (metadata.size > maximumBytes)
      throw new Error("Private file exceeds its limit.");
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > maximumBytes)
      throw new Error("Private file exceeds its limit.");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Caller verifies a fresh, exclusively held destination. Native resume policy stays with its owner. */
export async function publishPrivateDirectory(
  home: string,
  target: string,
  files: Readonly<Record<string, string>>,
  uid: number,
  gid: number,
): Promise<void> {
  const staging = await mkdtemp(join(home, ".clawscarf-bootstrap-"));
  try {
    const directories = new Set([home, staging]);
    for (const [name, content] of Object.entries(files)) {
      const path = join(staging, name);
      const directory = dirname(path);
      if (directory !== staging) {
        await mkdir(directory, { mode: 0o700, recursive: true });
        directories.add(directory);
      }
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
      await chown(path, uid, gid);
    }
    for (const directory of directories) await chown(directory, uid, gid);
    await chmod(home, 0o700);
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
