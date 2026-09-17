import Fastify from "fastify";
import { chmod, lstat, readFile, rm, mkdir } from "node:fs/promises";

import { setTimeout as delay } from "node:timers/promises";
import { nodeEntrypoint } from "../local/entrypoint.js";
import { administratorSetup } from "./administrator.js";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { launchLocal } from "../local/launch.js";
import {
  readState,
  withInstallationLock,
  writePrivate,
  type LocalState,
} from "../local/state.js";
import { LocalSetupError, run } from "../local/process.js";
import { openPrivateLog } from "../local/supervisor.js";
import { localLogNames } from "../local/logs.js";
import { InstallationError } from "./errors.js";
import { activatePacks, packOutcomeSchema, type PackOutcome } from "./packs.js";

const statusSchema = z.strictObject({
  supervisor: z.enum(["starting", "running", "stopping"]),
  ready: z.boolean(),
  packs: z.array(packOutcomeSchema),
  administrator: z.enum(["pending", "ready", "unavailable"]),
});
const socketPath = (directory: string) =>
  join(resolve(directory), "operator.sock");
function requireStartConfiguration(directory: string, state: LocalState) {
  if (!state.input.execution)
    throw new InstallationError(
      "invalid_configuration",
      "A protected execution worker is required.",
    );
  if (!state.input.modelGateway && !state.input.models)
    throw new InstallationError(
      "invalid_configuration",
      "Bundled or existing LiteLLM is required.",
    );
  if (Buffer.byteLength(socketPath(directory)) > 100)
    throw new InstallationError(
      "invalid_configuration",
      "Use a shorter state directory for the local control socket.",
    );
}
/** OS permissions protect this local control endpoint; it is never exposed over TCP. */
export async function superviseInstallation(
  directory: string,
  report: (message: string) => void,
) {
  directory = resolve(directory);
  return withInstallationLock(directory, async () => {
    const state = await readState(directory);
    requireStartConfiguration(directory, state);
    const stop = new AbortController();
    let supervisor: "starting" | "running" | "stopping" = "starting";
    let packs: PackOutcome[] = [];
    const app = Fastify({ logger: false });
    app.get("/status", async () => {
      const administrator =
        supervisor !== "running"
          ? "unavailable"
          : await administratorSetup(directory).then(
              (setup) =>
                setup.complete ? ("ready" as const) : ("pending" as const),
              () => "unavailable" as const,
            );
      return {
        supervisor,
        ready: supervisor === "running" && administrator === "ready",
        administrator,
        packs,
      };
    });
    app.post("/stop", async (_request, reply) => {
      supervisor = "stopping";
      await reply.send({
        supervisor,
        ready: false,
        administrator: "unavailable",
        packs,
      });
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
        onStopping: () => {
          supervisor = "stopping";
        },
      });
    } finally {
      await app.close();
      await rm(socketPath(directory), { force: true });
    }
  });
}

/** launchd owns the existing supervisor; closing a terminal does not own its lifetime. */
export async function startInstallation(
  directory: string,
  report: (message: string) => void,
) {
  directory = resolve(directory);
  const uid = process.getuid?.();
  if (process.platform !== "darwin" || uid === undefined)
    throw new InstallationError(
      "unsupported_platform",
      "This release supports macOS user services.",
    );
  const current = await controlInstallation(directory, "status");
  if (current.supervisor !== "not_running") return current;
  const { label, domain, plist, registered } = await withInstallationLock(
    directory,
    async () => {
      const state = await readState(directory);
      requireStartConfiguration(directory, state);
      const label = `com.clawscarf.${state.ownerId}`;
      const domain = `gui/${String(uid)}`;
      const plist = join(directory, "supervisor.plist");
      const job = await launchdJob(domain, label);
      // A running job can precede its control socket. Never replace it on a repeated start.
      if (job && !launchdExited(job))
        return { label, domain, plist, registered: true };
      if (job) await run("launchctl", ["bootout", `${domain}/${label}`]);
      const logs = join(directory, "logs");
      await mkdir(logs, { recursive: true, mode: 0o700 });
      const metadata = await lstat(logs);
      if (
        !metadata.isDirectory() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o077) !== 0
      )
        throw new InstallationError(
          "unavailable",
          "Installation logs must be private and owned by the current user.",
        );
      const xml = (value: string) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      const args = [
        process.execPath,
        ...nodeEntrypoint("../clawscarf"),
        "start",
        "--state",
        directory,
        "--foreground",
      ];
      await writePrivate(
        plist,
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((value) => `<string>${xml(value)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(process.cwd())}</string><key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string><key>HOME</key><string>${xml(process.env.HOME ?? "")}</string></dict>
<key>StandardOutPath</key><string>${xml(join(logs, "supervisor.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(logs, "supervisor.log"))}</string>
</dict></plist>`,
      );
      const log = await openPrivateLog(join(logs, "supervisor.log"));
      await log.close();
      return { label, domain, plist, registered: false };
    },
  );
  // Release the operator lock before launchd starts the lifetime-owning supervisor.
  if (!registered) {
    try {
      await run("launchctl", ["bootstrap", domain, plist]);
    } catch (error) {
      // launchd registration is atomic: another simultaneous start may already own it.
      if (!(await launchdJob(domain, label))) throw error;
    }
  }
  report("Starting services. Logs: " + join(directory, "logs/supervisor.log"));
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await delay(1000);
    const status = await controlInstallation(directory, "status");
    if (status.supervisor === "running") return status;
    const job = await launchdJob(domain, label);
    if (!job || launchdExited(job))
      throw new InstallationError(
        "unavailable",
        "Startup stopped. Read the supervisor log before retrying.",
      );
  }
  throw new InstallationError(
    "unavailable",
    "Startup is still pending. Use status and logs; do not start a second installation.",
  );
}
function launchdExited(job: string) {
  return !/\bpid = \d+/.test(job) && /last exit code = -?\d+/.test(job);
}
async function launchdJob(domain: string, label: string) {
  try {
    return await run("launchctl", ["print", `${domain}/${label}`]);
  } catch (error) {
    if (
      error instanceof LocalSetupError &&
      error.commandFailure?.reason === "exit" &&
      error.commandFailure.exitCode === 113
    )
      return undefined;
    throw error;
  }
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
export async function installationLogs(directory: string, service: string) {
  await readState(resolve(directory));
  const name = z.enum(localLogNames).parse(service);
  const log = await readFile(
    join(resolve(directory), "logs", `${name}.log`),
    "utf8",
  );
  return log.split("\n").slice(-100).join("\n");
}
