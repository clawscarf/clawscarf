import { lstat, mkdir, readdir, rmdir } from "node:fs/promises";
import {
  assertPrivateFile,
  isMissingFile,
  privateDirectory,
  readPrivateFile,
  publishPrivateDirectory,
} from "./private-files.js";
import { join } from "node:path";
import { z } from "zod";

const inputSchema = z.strictObject({
  ownerId: z.uuid(),
  serverId: z.uuid(),
  configuration: z.string().min(1),
  executionCredential: z
    .strictObject({
      clientKey: z
        .string()
        .startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n")
        .max(8192),
      knownHosts: z.string().min(1).max(8192),
    })
    .optional(),
  modelCredential: z
    .strictObject({
      token: z
        .string()
        .min(1)
        .max(65536)
        .refine((value) => value.trim().length > 0),
      ca: z.string().optional(),
    })
    .optional(),
  connectionsCredential: z
    .strictObject({
      token: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[\x21-\x7e]+$/u),
      ca: z.string().optional(),
    })
    .optional(),
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
      }).parse(
        JSON.parse(
          (
            await readPrivateFile(join(target, marker), 16384, { uid, gid })
          ).toString("utf8"),
        ),
      );
      await privateDirectory(target, { uid, gid });
      assertPrivateFile(await lstat(join(target, "openclaw.json")), {
        uid,
        gid,
      });
      return;
    }
    await rmdir(target);
  } catch (error) {
    if (!isMissingFile(error, target)) throw error;
  }
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (!(await lstat(home)).isDirectory())
    throw new Error("Native home must be a directory.");
  const files: Record<string, string> = {
    "openclaw.json": input.configuration,
    [marker]: JSON.stringify({
      ownerId: input.ownerId,
      serverId: input.serverId,
    }),
  };
  if (input.executionCredential) {
    files["clawscarf-execution/client_ed25519"] =
      input.executionCredential.clientKey;
    files["clawscarf-execution/known_hosts"] =
      input.executionCredential.knownHosts;
  }
  if (input.modelCredential) {
    files["clawscarf-models/initial.json"] = JSON.stringify({
      token: input.modelCredential.token,
    });
    if (input.modelCredential.ca !== undefined)
      files["clawscarf-models/ca.pem"] = input.modelCredential.ca;
  }
  if (input.connectionsCredential) {
    files["clawscarf-connections/runtime.json"] = JSON.stringify({
      token: input.connectionsCredential.token,
    });
    if (input.connectionsCredential.ca !== undefined)
      files["clawscarf-connections/ca.pem"] = input.connectionsCredential.ca;
  }
  await publishPrivateDirectory(home, target, files, uid, gid);
}
