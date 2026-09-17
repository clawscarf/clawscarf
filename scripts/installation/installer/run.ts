import { registerHostedLogin } from "../../cloud/registration.js";
import { authorizeCloud } from "../../cloud/login.js";
import { savedSetup } from "../configure.js";
import * as clack from "@clack/prompts";
import { styleText } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
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
import { InstallationError } from "../errors.js";

const operations = {
  plan: planInstallation,
  doctor: doctorInstallation,
  apply: applyInstallation,
  start: startInstallation,
  administrator: administratorSetup,
  register: registerHostedLogin,
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
  const saved = await savedSetup(options);
  let draft: Awaited<ReturnType<typeof collectInstallation>> | undefined;
  while (!saved) {
    draft = await collectInstallation(ui, options, draft);
    try {
      if (await ui.confirm(`Install in ${draft.directory}?`, true)) break;
      return { state: "cancelled" };
    } catch (error) {
      if (!(error instanceof SectionCancelled)) throw error;
    }
  }
  const setup =
    saved ??
    (draft
      ? {
          configFile: await saveConfiguration(
            draft.directory,
            draft.config,
            draft.inputs,
          ),
          config: draft.config,
        }
      : undefined);
  if (!setup)
    throw new InstallationError(
      "invalid_configuration",
      "No installation settings were collected.",
    );
  const { configFile, config } = setup;
  const directory = dirname(configFile);
  const planFile = join(directory, "preview.json");
  const stateDirectory = resolve(directory, config.stateDirectory);
  try {
    await task("Setting up sign-in", (signal) =>
      operator.register(configFile, (url) =>
        authorizeCloud(
          url,
          (link, code) => {
            ui.note(
              `${terminalLink(link)}\n\nApproval code: ${code}`,
              styleText(
                ["bold", "yellow"],
                "ACTION REQUIRED — Sign in to ClawScarf",
              ),
            );
          },
          signal,
        ),
      ),
    );
    const plan = await task("Checking installation settings", () =>
      operator.plan(configFile),
    );
    await writeFile(planFile, JSON.stringify(plan, null, 2) + "\n", {
      mode: 0o600,
    });
    await task("Checking Docker and required images", () =>
      operator.doctor(configFile),
    );
    await task("Installing ClawScarf", () =>
      operator.apply(configFile, planFile),
    );
    const files = { configFile, planFile, stateDirectory };
    if (!(await ui.confirm("Start now?", true))) {
      ui.note(`clawscarf start --directory ${quote(directory)}`, "Start later");
      return { state: "prepared", ...files };
    }
    await task("Starting ClawScarf", (_signal, report) =>
      operator.start(stateDirectory, report),
    );
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
        : `http://127.0.0.1:${String(config.exposure.applicationPort)}`;
    ui.note(terminalLink(origin), "OpenClaw");
    ui.note(
      `Status: clawscarf status --directory ${quote(directory)}\nStop: clawscarf stop --directory ${quote(directory)}`,
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
      `Resume: clawscarf install --directory ${quote(directory)}\nConfiguration: ${configFile}\nStatus: clawscarf status --directory ${quote(directory)}\nLogs: clawscarf logs --directory ${quote(directory)} --service controller\nThe server, if started, keeps running. No failed operation is automatically repeated.`,
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
      `ClawScarf has started. Open this private link in your browser to sign in, then return here.\n\n${terminalLink(link.url)}\n\nExpires at ${link.expiresAt}.`,
      styleText(["bold", "yellow"], "ACTION REQUIRED — Administrator sign-in"),
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
