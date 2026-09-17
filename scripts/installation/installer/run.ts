import * as clack from "@clack/prompts";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { collectInstallation, type InstallOptions } from "./collect.js";
import {
  InstallerCancelled,
  SectionCancelled,
  progress,
  requireTerminal,
  terminalPrompts,
  type InstallerPrompts,
} from "./prompts.js";
import { saveConfiguration } from "../save.js";
import { planInstallation, applyInstallation } from "../plan.js";
import { doctorInstallation } from "../doctor.js";
import { startInstallation } from "../lifecycle.js";
import { administratorSetup } from "../administrator.js";
import { localLoginCode } from "../../local/login.js";
import { InstallationError } from "../errors.js";

const operations = {
  plan: planInstallation,
  doctor: doctorInstallation,
  apply: applyInstallation,
  start: startInstallation,
  administrator: administratorSetup,
  login: localLoginCode,
};
export async function installFromAnswers(
  options: InstallOptions,
  ui: InstallerPrompts,
  operator = operations,
  task: typeof progress = async (_message, work) =>
    work(new AbortController().signal, (message) => {
      ui.note(message, "Startup");
    }),
) {
  let draft: Awaited<ReturnType<typeof collectInstallation>> | undefined;
  for (;;) {
    draft = await collectInstallation(ui, options, draft);
    try {
      if (await ui.confirm(`Install in ${draft.directory}?`)) break;
      return { state: "cancelled" };
    } catch (error) {
      if (!(error instanceof SectionCancelled)) throw error;
    }
  }
  const { directory, config, inputs } = draft;
  const configFile = await saveConfiguration(directory, config, inputs);
  const planFile = join(directory, "preview.json");
  const stateDirectory = resolve(directory, config.stateDirectory);
  try {
    const plan = await task("Checking installation settings", () =>
      operator.plan(configFile),
    );
    await writeFile(planFile, JSON.stringify(plan, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await task("Checking Docker and required images", () =>
      operator.doctor(configFile),
    );
    await task("Installing ClawScarf", () =>
      operator.apply(configFile, planFile),
    );
    const files = { configFile, planFile, stateDirectory };
    if (!(await ui.confirm("Start now?"))) {
      ui.note(
        `pnpm clawscarf start --state ${quote(stateDirectory)}`,
        "Start later",
      );
      return { state: "prepared", ...files };
    }
    await task("Starting ClawScarf", (_signal, report) =>
      operator.start(stateDirectory, report),
    );
    if (config.access.mode === "oidc") {
      const current = await operator.administrator(stateDirectory);
      if (!current.complete) {
        const claim = await operator.administrator(stateDirectory, true);
        if (!claim.url || !claim.expiresAt)
          throw new InstallationError(
            "unavailable",
            "Administrator setup did not return a login link.",
          );
        ui.note(
          `${claim.url}\nPrivate, one-use link. Sign in to become this server's administrator. Expires at ${claim.expiresAt}.`,
          "Set up administrator",
        );
        await task("Waiting for administrator sign-in", async (signal) => {
          while (Date.now() < Date.parse(claim.expiresAt ?? "")) {
            signal.throwIfAborted();
            if ((await operator.administrator(stateDirectory)).complete) return;
            await delay(3000, undefined, { signal }).catch((error: unknown) => {
              signal.throwIfAborted();
              throw error;
            });
          }
          throw new InstallationError(
            "unavailable",
            `Setup link expired. Issue another with: pnpm clawscarf administrator --state ${quote(stateDirectory)} --issue`,
          );
        });
      }
      const origin =
        config.exposure.mode === "https"
          ? config.exposure.applicationOrigin
          : "";
      ui.note(origin, "Open OpenClaw");
    } else {
      const login = await operator.login(stateDirectory);
      ui.note(
        `${login.url}\nOne-use code: ${login.code}`,
        "Administrator login",
      );
    }
    ui.note(
      `Try a new chat in OpenClaw.\nStatus: pnpm clawscarf status --state ${quote(stateDirectory)}\nStop: pnpm clawscarf stop --state ${quote(stateDirectory)}`,
      "Server running",
    );
    return { state: "running", ...files };
  } catch (error) {
    if (
      error instanceof InstallerCancelled ||
      error instanceof SectionCancelled
    )
      throw error;
    ui.note(
      `Configuration: ${configFile}\nStatus: pnpm clawscarf status --state ${quote(stateDirectory)}\nLogs: pnpm clawscarf logs --state ${quote(stateDirectory)} --service supervisor\nThe server, if started, keeps running. No failed operation is automatically repeated.`,
      "Installation needs attention",
    );
    throw error;
  }
}
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function runInstaller(options: InstallOptions) {
  requireTerminal();
  clack.intro("ClawScarf — protected OpenClaw for your team");
  try {
    const result = await installFromAnswers(
      options,
      terminalPrompts,
      operations,
      progress,
    );
    if (result.state === "cancelled") clack.cancel("Cancelled.");
    else
      clack.outro(
        result.state === "prepared"
          ? "Installed. Start it when ready."
          : "ClawScarf is running. You can close this terminal.",
      );
  } catch (error) {
    if (
      !(error instanceof InstallerCancelled) &&
      !(error instanceof SectionCancelled)
    )
      throw error;
    clack.cancel(
      "Exited. Saved files and any running installation are retained.",
    );
    process.exitCode = 130;
  }
}
