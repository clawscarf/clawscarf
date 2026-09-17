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
  terminalLink,
  type InstallerPrompts,
} from "./prompts.js";
import { saveConfiguration } from "../save.js";
import { planInstallation, applyInstallation } from "../plan.js";
import { doctorInstallation } from "../doctor.js";
import { startInstallation } from "../lifecycle.js";
import { administratorSetup } from "../administrator.js";
import { localLoginCode, localLoginStatus } from "../../local/login.js";
import { InstallationError } from "../errors.js";

const operations = {
  plan: planInstallation,
  doctor: doctorInstallation,
  apply: applyInstallation,
  start: startInstallation,
  administrator: administratorSetup,
  login: localLoginCode,
  loginStatus: localLoginStatus,
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
    if (!(await ui.confirm("Start now?", true))) {
      ui.note(
        `pnpm clawscarf start --directory ${quote(directory)}`,
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
        await browserSignIn(
          ui,
          task,
          () => operator.administrator(stateDirectory, true),
          () => operator.administrator(stateDirectory),
        );
      }
      const origin =
        config.exposure.mode === "https"
          ? config.exposure.applicationOrigin
          : "";
      ui.note(terminalLink(origin), "OpenClaw");
    } else {
      let code = "";
      await browserSignIn(
        ui,
        task,
        async () => {
          const login = await operator.login(stateDirectory);
          code = login.code;
          const url = new URL(login.url);
          url.searchParams.set("returnTo", "/_clawscarf/setup-complete");
          return { url: url.toString(), expiresAt: login.expiresAt };
        },
        () => operator.loginStatus(stateDirectory, code),
      );
    }
    ui.note(
      `Status: pnpm clawscarf status --directory ${quote(directory)}\nStop: pnpm clawscarf stop --directory ${quote(directory)}`,
      "Commands",
    );
    return { state: "running", ...files };
  } catch (error) {
    if (
      error instanceof InstallerCancelled ||
      error instanceof SectionCancelled
    )
      throw error;
    ui.note(
      `Configuration: ${configFile}\nStatus: pnpm clawscarf status --directory ${quote(directory)}\nLogs: pnpm clawscarf logs --directory ${quote(directory)} --service supervisor\nThe server, if started, keeps running. No failed operation is automatically repeated.`,
      "Installation needs attention",
    );
    throw error;
  }
}
async function browserSignIn(
  ui: InstallerPrompts,
  task: typeof progress,
  issue: () => Promise<{ url?: string | undefined; expiresAt: string | null }>,
  observe: () => Promise<{ complete: boolean; expiresAt: string | null }>,
) {
  for (;;) {
    const link = await issue();
    if (!link.url || !link.expiresAt)
      throw new InstallationError(
        "unavailable",
        "Administrator setup did not return a login link.",
      );
    ui.note(
      `${terminalLink(link.url)}\nPrivate, one-use link. Expires at ${link.expiresAt}.`,
      "Set up administrator",
    );
    const complete = await task(
      "Waiting for administrator sign-in",
      async (signal) => {
        for (;;) {
          signal.throwIfAborted();
          const status = await observe();
          if (status.complete) return true;
          if (!status.expiresAt || Date.now() >= Date.parse(status.expiresAt))
            return false;
          await delay(3000, undefined, { signal }).catch((error: unknown) => {
            signal.throwIfAborted();
            throw error;
          });
        }
      },
    );
    if (complete) return;
    if (!(await ui.confirm("Login link expired. Create a new link?", true)))
      throw new InstallerCancelled();
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
          ? "Installed. Not running."
          : "ClawScarf is running.",
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
