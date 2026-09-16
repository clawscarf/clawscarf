import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { parseLocalInput, type LocalInput } from "./configuration.js";
import { LocalSetupError } from "./process.js";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ownerId: z.uuid(),
  input: z.unknown().transform(parseLocalInput),
});
export type LocalState = z.infer<typeof stateSchema>;
export async function writePrivate(path: string, value: string | Buffer) {
  const temporary = path + "." + randomUUID();
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(value);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
/** Publish complete initial state, or retain an identical existing file. Never replace edits. */
export async function ensurePrivateFile(path: string, value: string | Buffer) {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      !Buffer.from(value).equals(await readFile(path))
    )
      throw new LocalSetupError(
        "configuration_changed",
        "An existing private configuration file differs from setup inputs. Setup will not overwrite it.",
      );
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = path + "." + randomUUID();
  try {
    await writePrivate(temporary, value);
    await link(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readState(directory: string): Promise<LocalState> {
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.uid !== process.getuid?.()
  )
    throw new LocalSetupError(
      "private_directory_required",
      "Use a private installation directory owned by the current user.",
    );
  return stateSchema.parse(
    JSON.parse(await readFile(join(directory, "installation.json"), "utf8")),
  );
}
export async function initializeState(path: string, input: LocalInput) {
  const directory = resolve(path);
  try {
    const existing = await readState(directory);
    if (!isDeepStrictEqual(existing.input, input))
      throw new LocalSetupError(
        "configuration_changed",
        "The supplied configuration differs from this installation. Setup never overwrites an existing installation.",
      );
    return existing;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    try {
      await lstat(directory);
    } catch (missing) {
      if (!(
        missing instanceof Error &&
        "code" in missing &&
        missing.code === "ENOENT"
      ))
        throw missing;
      await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(
        join(dirname(directory), ".clawscarf-init-"),
      );
      try {
        const state: LocalState = {
          schemaVersion: 1,
          ownerId: randomUUID(),
          input,
        };
        await writePrivate(
          join(staging, "installation.json"),
          JSON.stringify(state, null, 2) + "\n",
        );
        await mkdir(join(staging, "private"), { mode: 0o700 });
        for (const name of [
          "database-admin-password",
          "database-runtime-password",
        ])
          await writePrivate(
            join(staging, "private", name),
            randomBytes(32).toString("base64url"),
          );
        await writePrivate(
          join(staging, "private", "encryption.key"),
          randomBytes(32),
        );
        // mkdir reserves the destination; rename alone can replace an empty foreign directory.
        await mkdir(directory, { mode: 0o700 });
        await rename(staging, directory);
        return state;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    throw new LocalSetupError(
      "unowned_directory",
      "The destination exists without a ClawScarf installation identity; choose a new directory.",
    );
  }
}
export async function withInstallationLock<T>(
  directory: string,
  work: () => Promise<T>,
) {
  directory = resolve(directory);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  let release;
  try {
    release = await lockfile.lock(directory, {
      realpath: false,
      retries: 0,
      lockfilePath: directory + ".operator-lock",
    });
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ELOCKED"
    ))
      throw error;
    throw new LocalSetupError(
      "operation_busy",
      "Another installation operation is active. Wait for it to finish.",
    );
  }
  try {
    return await work();
  } finally {
    await release();
  }
}
export function resourceNames(state: LocalState) {
  const suffix = state.ownerId.replaceAll("-", "").slice(0, 12);
  return {
    project: `clawscarf-${suffix}`,
    sandbox: `cs-${suffix}`,
    volume: `clawscarf-${suffix}-home`,
    databaseVolume: `clawscarf-${suffix}-postgres`,
    workerSandbox: `csw-${suffix}`,
    workerVolume: `clawscarf-${suffix}-worker`,
    browserVolume: `clawscarf-${suffix}-browser`,
    browserNodeVolume: `clawscarf-${suffix}-browser-node`,
    browserNodeConfigVolume: `clawscarf-${suffix}-browser-node-config`,
  };
}
