import { runtimeRelayHost } from "./relay.js";
import { lstat, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parseDocument } from "yaml";
import { run, LocalSetupError } from "./process.js";
import {
  ensurePrivateFile,
  resourceNames,
  writePrivate,
  type LocalState,
} from "./state.js";

const publicKey = z
  .string()
  .trim()
  .regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/);
const keyNames = ["client_ed25519", "host_ed25519"] as const;

/** Generate worker-only keys once. Never copy controller or Gateway authority into execution. */
export async function prepareExecution(directory: string, state: LocalState) {
  if (!state.input.execution) return undefined;
  const target = join(directory, "private/execution");
  try {
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0)
      throw new LocalSetupError(
        "configuration_changed",
        "Execution credentials require a private directory.",
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const staging = await mkdtemp(join(directory, "private/.execution-"));
    try {
      for (const name of keyNames)
        await run("ssh-keygen", [
          "-q",
          "-t",
          "ed25519",
          "-N",
          "",
          "-C",
          "",
          "-f",
          join(staging, name),
        ]);
      await writePrivate(
        join(staging, "owner.json"),
        JSON.stringify({ ownerId: state.ownerId }),
      );
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  z.strictObject({ ownerId: z.literal(state.ownerId) }).parse(
    JSON.parse(await readFile(join(target, "owner.json"), "utf8")),
  );
  for (const name of keyNames) {
    const path = join(target, name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
      throw new LocalSetupError(
        "configuration_changed",
        "Execution credentials must remain private regular files.",
      );
    const derived = publicKey.parse(
      await run("ssh-keygen", ["-y", "-f", path]),
    );
    if (derived !== publicKey.parse(await readFile(path + ".pub", "utf8")))
      throw new LocalSetupError(
        "configuration_changed",
        "Execution key material is inconsistent; setup will not replace it.",
      );
  }
  const host = publicKey.parse(
    await readFile(join(target, "host_ed25519.pub"), "utf8"),
  );
  const port = String(state.input.execution.port);
  const knownHosts = `[${runtimeRelayHost}]:2222,[127.0.0.1]:${port} ${host}\n`;
  await ensurePrivateFile(join(target, "known_hosts"), knownHosts);
  const policy = parseDocument(
    await readFile(
      new URL("../../deploy/execution/worker/policy.yaml", import.meta.url),
      "utf8",
    ),
  );
  if (policy.errors.length || policy.warnings.length)
    throw new LocalSetupError(
      "invalid_runtime_policy",
      "The shipped execution policy is invalid.",
    );
  const value: unknown = policy.toJS();
  await ensurePrivateFile(
    join(directory, "private/execution-policy.json"),
    JSON.stringify(value),
  );
  return {
    clientKey: await readFile(join(target, "client_ed25519"), "utf8"),
    knownHosts,
    hostKey: await readFile(join(target, "host_ed25519"), "utf8"),
    authorizedKey:
      publicKey.parse(
        await readFile(join(target, "client_ed25519.pub"), "utf8"),
      ) + "\n",
  };
}
export type InitialExecution = NonNullable<
  Awaited<ReturnType<typeof prepareExecution>>
>;

/** Native SSH seeds each remote scope once; the worker volume then owns execution files. */
export function executionDefaults() {
  return {
    mode: "all",
    backend: "ssh",
    scope: "agent",
    workspaceAccess: "rw",
    ssh: {
      target: `node@${runtimeRelayHost}:2222`,
      workspaceRoot: "/home/node/sandboxes",
      strictHostKeyChecking: true,
      updateHostKeys: false,
      identityFile: "/home/node/.openclaw/clawscarf-execution/client_ed25519",
      knownHostsFile: "/home/node/.openclaw/clawscarf-execution/known_hosts",
    },
  };
}

export async function initializeExecutionVolume(
  state: LocalState,
  keys: InitialExecution,
) {
  await run(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--pull",
      "never",
      "--network",
      "none",
      "--user",
      "root",
      "--mount",
      `type=volume,source=${resourceNames(state).workerVolume},target=/home/node,volume-nocopy`,
      "--entrypoint",
      "node",
      state.input.runtimeImage,
      "/app/clawscarf/initialize-worker-main.js",
    ],
    {
      input: JSON.stringify({
        ownerId: state.ownerId,
        hostKey: keys.hostKey,
        authorizedKey: keys.authorizedKey,
      }),
    },
  );
}

export async function verifyExecutionListener(directory: string, port: number) {
  await run(
    "ssh",
    [
      "-F",
      "/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UpdateHostKeys=no",
      "-o",
      "ConnectTimeout=3",
      "-o",
      `UserKnownHostsFile=${join(directory, "private/execution/known_hosts")}`,
      "-i",
      join(directory, "private/execution/client_ed25519"),
      "-p",
      String(port),
      "node@127.0.0.1",
      "true",
    ],
    { timeout: 5000 },
  );
}
