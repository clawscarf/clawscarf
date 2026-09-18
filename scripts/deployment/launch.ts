import { applyConnectionPolicy } from "./connection-policy.js";
import { verifyRuntimeImage } from "./images.js";
import { startBrowserNode } from "./browser-node-pairing.js";
import { verifyBrowserNode } from "./browser-node.js";
import { verifyRelayConfiguration } from "./relay.js";
import {
  verifyBrowserListener,
  verifyBrowserConfiguration,
} from "./browser.js";
import { probeTeamAccess } from "./team.js";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readState, resourceNames } from "./state.js";
import { verifyLocalNetworks } from "./networks.js";
import { compose } from "./compose.js";
import { ensureRuntime, stopRuntime } from "./runtime.js";
import { LocalSetupError, run } from "./process.js";
import { verifyLocalExecutables, verifyLocalPorts } from "./preflight.js";
import { verifyRuntimeBinding } from "./runtime-binding.js";
import { requireNoUpgrade } from "./upgrade-state.js";

/** Internal operation: the caller holds the installation lock for its full lifetime. */
export async function launchLocal(
  directoryInput: string,
  report: (message: string) => void,
  control: {
    signal?: AbortSignal;
    activate?: () => Promise<void>;
  } = {},
) {
  const directory = resolve(directoryInput);
  const state = await readState(directory);
  z.strictObject({
    ownerId: z.literal(state.ownerId),
    settingsCandidate: z.string().optional(),
    settingsReapply: z.enum(["models", "connections"]).optional(),
  }).parse(
    JSON.parse(await readFile(join(directory, "prepared.json"), "utf8")),
  );
  if (Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")))
    throw new LocalSetupError(
      "configuration_changed",
      "Unset OPENSHELL_* overrides before starting this installation.",
    );
  const controller = join(directory, "controller");
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(controller, "config"),
    XDG_STATE_HOME: join(controller, "state"),
    XDG_DATA_HOME: join(controller, "data"),
  };
  const name = resourceNames(state).sandbox;
  await requireNoUpgrade(directory);
  await verifyRuntimeImage(state.input.runtimeImage);
  await verifyLocalExecutables(state);
  await verifyLocalPorts(state);
  await verifyLocalNetworks(directory, state);
  await verifyBrowserConfiguration(directory, state);
  await verifyBrowserNode(directory, state);
  await verifyRelayConfiguration(directory, state);
  const cancellation = new AbortController();
  const stopSignal = () => {
    cancellation.abort();
  };
  const check = () => {
    if (cancellation.signal.aborted)
      throw new LocalSetupError(
        "startup_interrupted",
        "Startup interrupted. Services already started remain available; use stop to stop the installation.",
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
  control.signal?.addEventListener("abort", stopSignal, { once: true });
  if (control.signal?.aborted) stopSignal();
  process.on("SIGINT", stopSignal);
  process.on("SIGTERM", stopSignal);
  try {
    report("Starting controller…");
    await compose(directory, ["up", "-d", "controller"]);
    await waitFor(async () => {
      await run(
        state.input.openshellCli,
        ["sandbox", "list", "--gateway", name, "--output", "json"],
        { env, timeout: 5000 },
      );
    });
    await applyConnectionPolicy(directory, state, env);
    if (state.input.modelGateway) {
      report("Starting model gateway…");
      await compose(directory, [
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "120",
        "models",
      ]);
      check();
    }
    if (state.input.browser) {
      report("Starting browser relay…");
      await compose(directory, ["up", "-d", "browser-relay"]);
      const browserPort = state.input.browser.port;
      await waitFor(() => verifyBrowserListener(directory, browserPort));
    }
    report("Starting OpenClaw…");
    const runtime = await ensureRuntime(directory, state, env);
    check();
    await compose(directory, ["up", "-d", "application", "widgets"]);
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
    await applyConnectionPolicy(directory, state, env, true);
    if (state.input.browser) {
      report("Starting native browser node…");
      await startBrowserNode(directory, state, cancellation.signal);
    }
    report("Starting access…");
    await compose(directory, ["up", "-d", "--wait", "companion"]);
    await waitFor(() =>
      probeTeamAccess(
        directory,
        state.input,
        AbortSignal.any([cancellation.signal, AbortSignal.timeout(3000)]),
      ),
    );
    check();
    report(`Open ${state.input.team.origin}`);
    await control.activate?.();
    check();
  } finally {
    control.signal?.removeEventListener("abort", stopSignal);
    process.off("SIGINT", stopSignal);
    process.off("SIGTERM", stopSignal);
  }
}

/** Stop entry first, then the owned runtime, and only then its controller. */
export async function stopLocal(directory: string) {
  const state = await readState(directory);
  const controller = join(directory, "controller");
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(controller, "config"),
    XDG_STATE_HOME: join(controller, "state"),
    XDG_DATA_HOME: join(controller, "data"),
  };
  await compose(directory, [
    "stop",
    "companion",
    "application",
    "widgets",
    ...(state.input.browser
      ? ["browser-node", "browser-node-ingress", "browser-node-dns"]
      : []),
  ]);
  // A stopped controller must be available to observe and stop its owned runtime.
  await compose(directory, ["up", "-d", "controller"]);
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await run(
        state.input.openshellCli,
        [
          "sandbox",
          "list",
          "--gateway",
          resourceNames(state).sandbox,
          "-o",
          "json",
        ],
        { env, timeout: 5000 },
      );
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(500);
    }
  }
  await stopRuntime(directory, state, env);
  await compose(directory, ["stop"]);
}
