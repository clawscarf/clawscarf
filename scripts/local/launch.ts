import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readState, resourceNames, withLocalLock } from "./state.js";
import { verifyLocalNetworks } from "./networks.js";
import { compose } from "./compose.js";
import { startProcess, type ManagedProcess } from "./supervisor.js";
import { ensureRuntime, stopRuntime } from "./runtime.js";
import { nodeEntrypoint } from "./entrypoint.js";
import { LocalSetupError, run } from "./process.js";
import { localLoginCode, verifyLocalAdministrator } from "./login.js";
import { verifyLocalExecutables, verifyLocalPorts } from "./preflight.js";
import { verifyRuntimeBinding } from "./runtime-binding.js";
import { requireNoUpgrade } from "./upgrade-state.js";

export async function launchLocal(
  directoryInput: string,
  report: (message: string) => void,
) {
  const directory = resolve(directoryInput);
  const state = await readState(directory);
  z.strictObject({ ownerId: z.literal(state.ownerId) }).parse(
    JSON.parse(await readFile(join(directory, "prepared.json"), "utf8")),
  );
  if (Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")))
    throw new LocalSetupError(
      "configuration_changed",
      "Unset OPENSHELL_* overrides before starting this installation.",
    );
  const controller = join(directory, "controller"),
    logs = join(directory, "logs");
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(controller, "config"),
    XDG_STATE_HOME: join(controller, "state"),
    XDG_DATA_HOME: join(controller, "data"),
  };
  const name = resourceNames(state).sandbox;
  await withLocalLock(directory, async () => {
    await requireNoUpgrade(directory);
    await verifyLocalExecutables(state);
    await verifyLocalPorts(state);
    await verifyLocalNetworks(directory, state);
    const children: ManagedProcess[] = [];
    const lifetime = { stopped: false, childExited: false };
    let runtimeAttempted = false;
    const signal = Promise.withResolvers<undefined>();
    const cancellation = new AbortController();
    const stopSignal = () => {
      lifetime.stopped = true;
      cancellation.abort();
      signal.resolve(undefined);
    };
    async function spawn(executable: string, args: string[], log: string) {
      const child = await startProcess(executable, args, {
        env,
        logFile: join(logs, log),
      });
      children.push(child);
      void child.done.then(() => {
        lifetime.childExited = true;
      });
      return child;
    }
    const check = () => {
      if (lifetime.stopped || lifetime.childExited)
        throw new LocalSetupError(
          "startup_interrupted",
          "Local processes stopped. Inspect this installation's private logs before resuming.",
        );
    };
    async function waitFor(probe: () => Promise<void>) {
      const deadline = Date.now() + 90_000;
      let lastFailure: unknown;
      while (Date.now() < deadline) {
        check();
        try {
          await probe();
          check();
          return;
        } catch (error) {
          check();
          lastFailure = error;
          await delay(500);
        }
      }
      throw lastFailure instanceof Error
        ? lastFailure
        : new LocalSetupError(
            "startup_timed_out",
            "Local startup did not become ready before its deadline.",
          );
    }
    process.on("SIGINT", stopSignal);
    process.on("SIGTERM", stopSignal);
    let failure: Error | undefined;
    try {
      report("Starting controller…");
      await spawn(
        process.execPath,
        [
          ...nodeEntrypoint("../controller"),
          "start",
          "--directory",
          controller,
        ],
        "controller.log",
      );
      await waitFor(async () => {
        await run(
          state.input.openshellCli,
          ["sandbox", "list", "--gateway", name, "--output", "json"],
          { env, timeout: 5000 },
        );
      });
      report("Starting OpenClaw…");
      runtimeAttempted = true;
      const runtime = await ensureRuntime(directory, state, env);
      check();
      for (const [label, port] of [
        ["application", state.input.ports.native],
        ["widgets", state.input.ports.nativeWidgets],
      ] as const)
        await spawn(
          state.input.openshellCli,
          ["forward", "start", String(port), name, "--gateway", name],
          `${label}.log`,
        );
      await waitFor(async () => {
        const response = await fetch(
          `http://127.0.0.1:${String(state.input.ports.native)}/healthz`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (!response.ok)
          throw new LocalSetupError(
            "native_unavailable",
            "OpenClaw has not become healthy.",
          );
        await response.body?.cancel();
      });
      await verifyRuntimeBinding(state, runtime);
      report("Starting access and verifying administrator…");
      await compose(directory, ["up", "-d", "--wait", "companion"]);
      for (const service of ["companion", "postgres"])
        await spawn(
          "docker",
          ["compose", "-f", join(directory, "compose.json"), "wait", service],
          `${service}-wait.log`,
        );
      const origin = `http://127.0.0.1:${String(state.input.ports.application)}`;
      await waitFor(async () => {
        const response = await fetch(origin + "/_clawscarf/health", {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok)
          throw new LocalSetupError(
            "native_unavailable",
            "The access companion has not become healthy.",
          );
        await response.body?.cancel();
      });
      // This may create a one-use login, so it is deliberately not retried by waitFor.
      await verifyLocalAdministrator(
        directory,
        origin,
        AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]),
      );
      check();
      const login = await localLoginCode(directory);
      report(
        `Open ${login.url}\nOne-use code (expires in five minutes): ${login.code}\nPress Ctrl+C to stop. Your data will be retained.`,
      );
      await Promise.race([
        signal.promise,
        ...children.map((child) => child.done),
      ]);
      if (!lifetime.stopped)
        throw new LocalSetupError(
          "process_exited",
          "A required local process exited. Inspect this installation's private logs.",
        );
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new LocalSetupError(
              "startup_failed",
              "Local startup could not be verified. Inspect this installation before retrying.",
            );
    } finally {
      report("Stopping local services; retaining data…");
      const errors: unknown[] = [];
      try {
        await compose(directory, ["stop", "companion"]);
      } catch (error) {
        errors.push(error);
      }
      for (const child of children.slice(1).reverse()) {
        if ((await child.stop()).kind === "failed")
          errors.push(Error("Forward cleanup failed."));
      }
      if (runtimeAttempted)
        try {
          await stopRuntime(directory, state, env);
        } catch (error) {
          errors.push(error);
        }
      const first = children[0];
      if (first && (await first.stop()).kind === "failed")
        errors.push(Error("Controller cleanup failed."));
      try {
        await compose(directory, ["stop", "postgres"]);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) {
        report(
          "Some local services could not be confirmed stopped. Inspect this installation before restarting; data was retained.",
        );
        failure ??= new LocalSetupError(
          "cleanup_failed",
          "Local cleanup did not confirm every service stopped.",
        );
      }
      process.off("SIGINT", stopSignal);
      process.off("SIGTERM", stopSignal);
    }
    if (failure) throw failure;
  });
}
