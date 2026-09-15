import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { z } from "zod";
import { type LocalState, resourceNames } from "./state.js";
import { LocalSetupError, run } from "./process.js";

/** A bind probe detects current conflicts; it does not reserve a port for startup. */
async function available(port: number): Promise<boolean> {
  const server = createServer((socket) => {
    socket.destroy();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
    });
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EADDRINUSE"
    )
      return false;
    throw new LocalSetupError(
      "port_check_failed",
      `Cannot check local port ${String(port)}. Check local network permissions before retrying.`,
    );
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
  }
}

async function ownedDatabaseListener(state: LocalState, command: typeof run) {
  const project = resourceNames(state).project;
  const ids = (
    await command("docker", [
      "container",
      "ls",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=clawscarf.installation=${state.ownerId}`,
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "label=com.docker.compose.service=postgres",
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0] ?? "")) return false;
  const id = ids[0];
  if (!id) return false;
  // Inspect only ownership and listener fields, never container environment/secrets.
  const format =
    '{"running":{{json .State.Running}},"owner":{{json (index .Config.Labels "clawscarf.installation")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .NetworkSettings.Ports}}}';
  const result: unknown = JSON.parse(
    await command("docker", ["container", "inspect", "--format", format, id]),
  );
  return z
    .strictObject({
      running: z.literal(true),
      owner: z.literal(state.ownerId),
      project: z.literal(project),
      service: z.literal("postgres"),
      ports: z.strictObject({
        "5432/tcp": z.tuple([
          z.strictObject({
            HostIp: z.literal("127.0.0.1"),
            HostPort: z.literal(String(state.input.ports.database)),
          }),
        ]),
      }),
    })
    .safeParse(result).success;
}

/** Permit the exact retained database listener, never an unrelated occupied port. */
export async function verifyLocalPorts(
  state: LocalState,
  command: typeof run = run,
) {
  for (const [name, port] of Object.entries(state.input.ports)) {
    if (await available(port)) continue;
    if (name === "database" && (await ownedDatabaseListener(state, command)))
      continue;
    throw new LocalSetupError(
      "port_in_use",
      `The ${name} port 127.0.0.1:${String(port)} is already in use. Stop its current owner or select different ports for a new installation before retrying.`,
    );
  }
}

export async function verifyLocalExecutables(state: LocalState) {
  for (const [name, path] of [
    ["OpenShell CLI", state.input.openshellCli],
    ["OpenShell gateway", state.input.openshellGateway],
  ] as const) {
    try {
      await access(path, constants.X_OK);
      if (!(await stat(path)).isFile()) throw Error("Not an executable file.");
    } catch {
      throw new LocalSetupError(
        "executable_unavailable",
        `The configured ${name} executable is unavailable. Install the pinned executable and check its permissions before retrying.`,
      );
    }
  }
}
