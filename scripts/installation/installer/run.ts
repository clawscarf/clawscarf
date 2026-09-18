import { CloudAuthorizationRequired } from "../../cloud/login.js";
import { editInstallationSettings } from "./settings.js";
import { registerCloudServices } from "../../cloud/registration.js";
import { registerWithBrowser, registerUnattended } from "./cloud.js";
import {
  savedSetup,
  prepareConfiguration,
  rejectNewSelections,
} from "../configure.js";
import * as clack from "@clack/prompts";
import { styleText } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { collectInstallation, type InstallOptions } from "./collect.js";
import {
  InstallerCancelled,
  SectionCancelled,
  progress,
  requireTerminal,
  terminalPrompts,
  unattendedPrompts,
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
  register: registerCloudServices,
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
  if (saved) rejectNewSelections(options);
  let draft: Awaited<ReturnType<typeof collectInstallation>> | undefined;
  while (!saved) {
    draft = options.nonInteractive
      ? await prepareConfiguration(options)
      : await collectInstallation(ui, options, draft);
    if (options.nonInteractive) break;
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
    if (options.nonInteractive)
      await registerUnattended(
        configFile,
        options.cloudCredentialFile,
        operator.register,
      );
    else await registerWithBrowser(configFile, ui, task, operator.register);
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
    if (!(
      options.start ??
      (options.nonInteractive ? true : await ui.confirm("Start now?", true))
    )) {
      ui.note(`clawscarf start --directory ${quote(directory)}`, "Start later");
      return { state: "prepared", directory };
    }
    await task("Starting ClawScarf", (_signal, report) =>
      operator.start(stateDirectory, report),
    );
    const administrator = await finishAdministrator(
      stateDirectory,
      options,
      ui,
      task,
      operator.administrator,
      true,
    );
    if (administrator)
      return {
        state: "action_required",
        ready: false,
        ...administrator,
        directory,
        resume: `clawscarf status --directory ${quote(directory)} --json`,
      };
    const origin =
      config.exposure.mode === "https"
        ? config.exposure.applicationOrigin
        : `http://127.0.0.1:${String(config.exposure.applicationPort)}`;
    ui.note(terminalLink(origin), "OpenClaw");
    ui.note(
      `Status: clawscarf status --directory ${quote(directory)}\nStop: clawscarf stop --directory ${quote(directory)}`,
      "Commands",
    );
    return { state: "running", directory };
  } catch (error) {
    if (error instanceof CloudAuthorizationRequired)
      return {
        state: "action_required",
        action: "cloud_authorization",
        ...error.action,
        directory,
        resume: `clawscarf configure --directory ${quote(directory)} --non-interactive --json`,
      };
    if (
      error instanceof InstallerCancelled ||
      error instanceof SectionCancelled
    )
      throw error;
    ui.note(
      `Resume: clawscarf configure --directory ${quote(directory)}\nStatus: clawscarf status --directory ${quote(directory)}\nLogs: clawscarf logs --directory ${quote(directory)} --service controller\nThe server, if started, keeps running. No failed operation is automatically repeated.`,
      "Installation needs attention",
    );
    throw error;
  }
}
async function finishAdministrator(
  state: string,
  options: InstallOptions,
  ui: InstallerPrompts,
  task: typeof progress,
  administrator = administratorSetup,
  verify = false,
) {
  const current = await task("Verifying administrator access", () =>
    administrator(state, false, verify),
  );
  if (current.complete) return undefined;
  if (options.nonInteractive)
    return {
      action: "administrator_sign_in",
      ...(await administrator(state, true)),
    };
  await browserSignIn(
    ui,
    task,
    () => administrator(state, true),
    () => administrator(state),
  );
  return undefined;
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

/** The command selects the workflow; users never manipulate preparation files. */
export async function runConfiguration(options: InstallOptions) {
  if (options.json && !options.nonInteractive)
    throw new InstallationError(
      "invalid_configuration",
      "Use --non-interactive with --json.",
    );
  if (!options.nonInteractive) {
    requireTerminal();
    clack.intro("ClawScarf — protected OpenClaw for your team");
  }
  const ui = options.nonInteractive ? unattendedPrompts : terminalPrompts;
  try {
    const saved = await savedSetup(options);
    const state = saved
      ? resolve(dirname(saved.configFile), saved.config.stateDirectory)
      : undefined;
    let existing = false;
    if (state) {
      try {
        await access(join(state, "settings.json"));
        existing = true;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    const result =
      existing && state
        ? await editInstallationSettings(state, ui, options)
        : await installFromAnswers(options, ui, operations, (message, work) =>
            progress(message, work, options),
          );
    if (existing && state && result.state === "running") {
      const administrator = await finishAdministrator(
        state,
        options,
        ui,
        (message, work) => progress(message, work, options),
      );
      if (administrator)
        return {
          state: "action_required",
          ready: false,
          ...administrator,
          directory: options.directory,
          resume: `clawscarf status --directory ${quote(resolve(options.directory ?? "."))} --json`,
        };
    }
    if (!options.nonInteractive) {
      if (result.state === "cancelled") clack.cancel("Cancelled.");
      else
        clack.outro(
          result.state === "running"
            ? "ClawScarf is running."
            : "Configuration saved. Server stopped.",
        );
    }
    return result;
  } catch (error) {
    if (error instanceof CloudAuthorizationRequired)
      return {
        state: "action_required",
        action: "cloud_authorization",
        ...error.action,
        directory: options.directory,
        resume: `clawscarf configure --directory ${quote(resolve(options.directory ?? "."))} --non-interactive --yes --json`,
      };
    if (
      !(error instanceof InstallerCancelled) &&
      !(error instanceof SectionCancelled)
    )
      throw error;
    if (!options.nonInteractive)
      clack.cancel(
        "Exited. Saved files and any running installation are retained.",
      );
    process.exitCode = 130;
    return { state: "cancelled" };
  }
}
