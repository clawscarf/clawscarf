import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LocalSetupError } from "./process.js";

export type ProcessOutcome =
  | { kind: "exited"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "failed"; code: "spawn_failed" | "cleanup_failed" };

export interface ManagedProcess {
  /** Always resolves, including unexpected exits; callers decide whether an exit is expected. */
  done: Promise<ProcessOutcome>;
  stop(): Promise<ProcessOutcome>;
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}

async function waitForGroupExit(pid: number, milliseconds: number) {
  const deadline = performance.now() + milliseconds;
  do {
    if (!signalGroup(pid, 0)) return true;
    await delay(25);
  } while (performance.now() < deadline);
  return !signalGroup(pid, 0);
}

/** Foreground ownership is in memory. Detached creates a POSIX group, not a daemon. */
export async function startProcess(
  executable: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; logFile: string },
): Promise<ManagedProcess> {
  if (process.platform === "win32")
    throw new LocalSetupError(
      "platform_unqualified",
      "Process supervision requires POSIX process groups.",
    );
  const log = await open(
    options.logFile,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await log.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0
    )
      throw new LocalSetupError(
        "private_log_required",
        "Use a private log file owned by the current user.",
      );
    const child = spawn(executable, Array.from(args), {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      ...(options.env ? { env: options.env } : {}),
    });
    let cleanup: Promise<boolean> | undefined;
    const clean = () => {
      cleanup ??= (async () => {
        const pid = child.pid;
        if (pid === undefined) return true;
        try {
          if (!signalGroup(pid, "SIGTERM")) return true;
          if (await waitForGroupExit(pid, 2000)) return true;
          if (!signalGroup(pid, "SIGKILL")) return true;
          return await waitForGroupExit(pid, 1000);
        } catch {
          return false;
        }
      })();
      return cleanup;
    };
    let complete: (outcome: ProcessOutcome) => void = () => undefined;
    const done = new Promise<ProcessOutcome>((resolve) => {
      complete = resolve;
    });
    child.once("error", () => {
      complete({ kind: "failed", code: "spawn_failed" });
    });
    child.once("exit", (code, signal) => {
      void clean().then((cleaned) => {
        complete(
          cleaned
            ? { kind: "exited", code, signal }
            : { kind: "failed", code: "cleanup_failed" },
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", () => {
        reject(
          new LocalSetupError(
            "spawn_failed",
            "A local process could not be started. Inspect this installation's private log.",
          ),
        );
      });
    });
    return {
      done,
      async stop() {
        if (!(await clean())) return { kind: "failed", code: "cleanup_failed" };
        return done;
      },
    };
  } finally {
    await log.close();
  }
}
