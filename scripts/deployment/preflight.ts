import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { z } from "zod";
import { type LocalState, resourceNames } from "./state.js";
import { LocalSetupError, run } from "./process.js";

/** A bind probe detects current conflicts; it does not reserve a port for startup. */
export async function portAvailable(
  port: number,
  host: string,
): Promise<boolean> {
  const server = createServer((socket) => {
    socket.destroy();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host, port, exclusive: true }, resolve);
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

async function ownedListener(
  state: LocalState,
  name: string,
  port: number,
  host: string,
  command: typeof run,
) {
  const services: Record<string, string> = {
    database: "postgres",
    native: "application",
    nativeWidgets: "widgets",
    application: "companion",
    widgets: "companion",
    management: "companion",
    browser: "browser-relay",
  };
  const service = services[name] ?? name;
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
      `label=com.docker.compose.service=${service}`,
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0] ?? "")) return false;
  const id = ids[0];
  if (!id) return false;
  const format =
    '{"running":{{json .State.Running}},"owner":{{json (index .Config.Labels "clawscarf.installation")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .NetworkSettings.Ports}}}';
  const result = z
    .object({
      running: z.literal(true),
      owner: z.literal(state.ownerId),
      project: z.literal(project),
      service: z.literal(service),
      ports: z.record(
        z.string(),
        z
          .array(z.object({ HostIp: z.string(), HostPort: z.string() }))
          .nullable(),
      ),
    })
    .safeParse(
      JSON.parse(
        await command("docker", [
          "container",
          "inspect",
          "--format",
          format,
          id,
        ]),
      ),
    );
  return (
    result.success &&
    Object.values(result.data.ports).some((bindings) =>
      bindings?.some(
        (binding) =>
          binding.HostIp === host && binding.HostPort === String(port),
      ),
    )
  );
}

/** Repeated starts may reuse listeners belonging to this installation only. */
export async function verifyLocalPorts(
  state: LocalState,
  command: typeof run = run,
) {
  const ports = {
    ...state.input.ports,
    ...(state.input.modelGateway
      ? { models: state.input.modelGateway.port }
      : {}),
    ...(state.input.browser ? { browser: state.input.browser.port } : {}),
  };
  for (const [name, port] of Object.entries(ports)) {
    const host =
      state.input.team.certificateFile &&
      ["application", "widgets"].includes(name)
        ? "0.0.0.0"
        : "127.0.0.1";
    if (await portAvailable(port, host)) continue;
    if (await ownedListener(state, name, port, host, command)) continue;
    throw new LocalSetupError(
      "port_in_use",
      `The ${name} port ${host}:${String(port)} is already in use. Stop its current owner or select different ports for a new installation before retrying.`,
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
