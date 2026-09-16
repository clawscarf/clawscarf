import Fastify from "fastify";
import { chmod, lstat, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { launchLocal } from "../local/launch.js";
import { readState } from "../local/state.js";
import { withInstallationLock } from "./plan.js";
import { InstallationError } from "./errors.js";
import { activatePacks, packOutcomeSchema, type PackOutcome } from "./packs.js";

const statusSchema = z.strictObject({
  supervisor: z.enum(["starting", "running", "stopping"]),
  ready: z.boolean(),
  packs: z.array(packOutcomeSchema),
});
const socketPath = (directory: string) =>
  join(resolve(directory), "operator.sock");
/** OS permissions protect this local control endpoint; it is never exposed over TCP. */
export async function startInstallation(
  directory: string,
  report: (message: string) => void,
) {
  directory = resolve(directory);
  const state = await readState(directory);
  if (!state.input.execution)
    throw new InstallationError(
      "invalid_configuration",
      "A protected execution worker is required.",
    );
  if (Buffer.byteLength(socketPath(directory)) > 100)
    throw new InstallationError(
      "invalid_configuration",
      "Use a shorter state directory for the local control socket.",
    );
  return withInstallationLock(directory, async () => {
    const stop = new AbortController();
    let supervisor: "starting" | "running" | "stopping" = "starting";
    let packs: PackOutcome[] = [];
    const app = Fastify({ logger: false });
    app.get("/status", () => ({
      supervisor,
      ready: supervisor === "running",
      packs,
    }));
    app.post("/stop", async (_request, reply) => {
      supervisor = "stopping";
      await reply.send({ supervisor, ready: false, packs });
      stop.abort();
    });
    await rm(socketPath(directory), { force: true });
    await app.listen({ path: socketPath(directory) });
    await chmod(socketPath(directory), 0o600);
    try {
      await launchLocal(directory, report, {
        signal: stop.signal,
        activate: async () => {
          packs = await activatePacks(directory, report);
        },
        onReady: () => {
          supervisor = "running";
        },
      });
    } finally {
      await app.close();
      await rm(socketPath(directory), { force: true });
    }
  });
}
export async function controlInstallation(
  directory: string,
  action: "status" | "stop",
) {
  directory = resolve(directory);
  await readState(directory);
  try {
    const stat = await lstat(socketPath(directory));
    if (
      !stat.isSocket() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new InstallationError(
        "unavailable",
        "The installation control socket has invalid ownership.",
      );
    const value = await new Promise<unknown>((resolve, reject) => {
      const call = request(
        {
          socketPath: socketPath(directory),
          path: `/${action}`,
          method: action === "status" ? "GET" : "POST",
          timeout: 5000,
        },
        (response) => {
          const bytes: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 4096)
              response.destroy(new Error("Invalid control response"));
            else bytes.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              if (response.statusCode !== 200)
                throw Error("Control request rejected");
              resolve(JSON.parse(Buffer.concat(bytes).toString("utf8")));
            } catch {
              reject(
                new InstallationError(
                  "unavailable",
                  "Invalid installation control response.",
                ),
              );
            }
          });
        },
      );
      call.once("timeout", () =>
        call.destroy(
          new InstallationError(
            "unavailable",
            "Installation control timed out.",
          ),
        ),
      );
      call.once("error", reject);
      call.end();
    });
    return statusSchema.parse(value);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ECONNREFUSED"].includes(String(error.code))
    ) {
      if (action === "stop")
        throw new InstallationError(
          "not_running",
          "No active supervisor. Inspect retained resources before restarting.",
        );
      return { supervisor: "not_running", ready: false };
    }
    throw error;
  }
}
const logNames = [
  "controller",
  "execution",
  "application",
  "widgets",
  "companion-wait",
  "postgres-wait",
  "execution-relay-wait",
  "browser-node-wait",
] as const;
export async function installationLogs(directory: string, service: string) {
  await readState(resolve(directory));
  const name = z.enum(logNames).parse(service);
  const log = await readFile(
    join(resolve(directory), "logs", `${name}.log`),
    "utf8",
  );
  return log.split("\n").slice(-100).join("\n");
}
