import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { administratorSetup } from "./administrator.js";
import { launchLocal, stopLocal } from "../deployment/launch.js";
import { compose } from "../deployment/compose.js";
import {
  readState,
  resourceNames,
  withInstallationLock,
} from "../deployment/state.js";
import { run } from "../deployment/process.js";
import { localLogNames } from "../deployment/logs.js";
import { InstallationError } from "./errors.js";
import { activatePacks, packOutcomeSchema } from "./packs.js";

const containerSchema = z.object({
  Service: z.string(),
  State: z.string(),
  Health: z.string().optional(),
});

/** No daemon or cached readiness: observe Docker and the live Access endpoint. */
async function installationStatus(directory: string) {
  const state = await readState(directory);
  const rows = (await compose(directory, ["ps", "--all", "--format", "json"]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => containerSchema.parse(JSON.parse(line)));
  const expected = (await compose(directory, ["config", "--services"]))
    .trim()
    .split("\n");
  const containers = rows.map((row) => ({
    service: row.Service,
    state: row.State,
    ...(row.Health ? { health: row.Health } : {}),
  }));
  const sandboxRows = z
    .array(z.object({ State: z.string() }))
    .parse(
      JSON.parse(
        await run("docker", [
          "container",
          "ls",
          "--all",
          "--format",
          "json",
          "--filter",
          `label=openshell.ai/sandbox-namespace=${resourceNames(state).sandbox}`,
        ]).then(
          (output) =>
            "[" + output.trim().split("\n").filter(Boolean).join(",") + "]",
        ),
      ),
    );
  const running =
    rows.some((row) =>
      ["running", "restarting", "paused"].includes(row.State),
    ) ||
    sandboxRows.some((row) =>
      ["running", "restarting", "paused"].includes(row.State),
    );
  const containersReady =
    sandboxRows.length === 1 &&
    sandboxRows.every((row) => row.State === "running") &&
    expected.every((name) =>
      rows.some(
        (row) =>
          row.Service === name &&
          row.State === "running" &&
          (!row.Health || row.Health === "healthy"),
      ),
    );
  const servicesReady =
    containersReady &&
    (await fetch(
      `http://127.0.0.1:${String(state.input.ports.native)}/healthz`,
      { signal: AbortSignal.timeout(3000) },
    ).then(
      async (response) => {
        await response.body?.cancel();
        return response.ok;
      },
      () => false,
    ));
  const administrator = servicesReady
    ? await administratorSetup(directory).then(
        (setup) => (setup.complete ? ("ready" as const) : ("pending" as const)),
        () => "unavailable" as const,
      )
    : ("unavailable" as const);
  let packs: z.infer<typeof packOutcomeSchema>[] = [];
  try {
    packs = z
      .array(packOutcomeSchema)
      .parse(
        JSON.parse(await readFile(join(directory, "pack-status.json"), "utf8")),
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return {
    state: !running
      ? ("stopped" as const)
      : servicesReady && administrator !== "unavailable"
        ? ("running" as const)
        : ("degraded" as const),
    ready:
      servicesReady &&
      administrator === "ready" &&
      packs.every((pack) => pack.state === "complete"),
    administrator,
    packs,
    services: containers,
  };
}

export async function startInstallation(
  directory: string,
  report: (message: string) => void,
) {
  directory = resolve(directory);
  return withInstallationLock(directory, async () => {
    const state = await readState(directory);
    if (!state.input.modelGateway && !state.input.models)
      throw new InstallationError(
        "invalid_configuration",
        "Bundled or existing LiteLLM is required.",
      );
    await launchLocal(directory, report, {
      activate: async () => {
        await activatePacks(directory, report);
      },
    });
    return installationStatus(directory);
  });
}

export async function controlInstallation(
  directory: string,
  action: "status" | "stop",
) {
  directory = resolve(directory);
  await readState(directory);
  if (action === "stop")
    await withInstallationLock(directory, async () => {
      if ((await installationStatus(directory)).state !== "stopped")
        await stopLocal(directory);
    });
  return installationStatus(directory);
}

export async function installationLogs(directory: string, service: string) {
  await readState(resolve(directory));
  const name = z.enum(localLogNames).parse(service);
  return compose(directory, ["logs", "--no-color", "--tail", "100", name]);
}

/** Administrator verification completes setup; it cannot make failed services or packs ready. */
export function withVerifiedAdministrator(
  status: Awaited<ReturnType<typeof startInstallation>>,
) {
  return {
    ...status,
    administrator: "ready" as const,
    ready:
      status.state === "running" &&
      status.packs.every((pack) => pack.state === "complete"),
  };
}
