import * as clack from "@clack/prompts";
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
import { InstallationError } from "../errors.js";

// The wizard calls the same operators as the noninteractive commands; it owns no provisioning logic.
const operations = {
  plan: planInstallation,
  doctor: doctorInstallation,
  apply: applyInstallation,
  start: startInstallation,
};
export async function installFromAnswers(
  options: InstallOptions,
  ui: InstallerPrompts,
  operator = operations,
  task: typeof progress = async (_message, work) => work(),
) {
  const { directory, config, inputs } = await collectInstallation(ui, options);
  if (
    !(await ui.confirm(
      `Save configuration and private credential copies in ${directory}?`,
    ))
  )
    return { state: "cancelled" };
  const configFile = await saveConfiguration(directory, config, inputs);
  const planFile = join(directory, "preview.json");
  const stateDirectory = resolve(directory, config.stateDirectory);
  ui.note(
    `Configuration: ${configFile}\nState: ${stateDirectory}\nKeep this directory private. Existing releases, catalogs and pack sources remain external inputs.`,
    "Files saved",
  );
  try {
    const plan = await task(
      "Validating files and creating the installation preview",
      () => operator.plan(configFile),
    );
    if (plan.action !== "prepare")
      throw new InstallationError(
        "change_unsupported",
        "The installer only creates new installations. Review existing state using the CLI.",
      );
    await writeFile(planFile, JSON.stringify(plan, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    ui.note(
      `Release: ${plan.release}\nAction: prepare a new installation\nPreview: ${planFile}\nPreparation creates private state, Docker resources, initial native settings and selected credentials. Start launches the server and installs selected packs.`,
      "Preview",
    );
    const action = await ui.select("Continue", [
      { value: "save", label: "Save preview and exit" },
      { value: "prepare", label: "Prepare installation" },
      {
        value: "start",
        label: "Prepare and start",
        hint: "Runs in this terminal; Ctrl+C stops the server",
      },
    ]);
    if (action === "save")
      return { state: "saved", configFile, planFile, stateDirectory };
    if (action !== "prepare" && action !== "start")
      throw new InstallationError(
        "invalid_configuration",
        "Select a supported installation action.",
      );
    await task("Checking Docker, images and selected dependencies", () =>
      operator.doctor(configFile),
    );
    await task("Preparing installation (this can take several minutes)", () =>
      operator.apply(configFile, planFile),
    );
    if (action === "prepare") {
      ui.note(
        `Start with: pnpm clawscarf start --state ${quote(stateDirectory)}`,
        "Prepared; not yet running",
      );
      return { state: "prepared", configFile, planFile, stateDirectory };
    }
    ui.note(
      "Starting in the foreground. Readiness and login details appear below. Ctrl+C stops the installation and retains its data.",
      "Starting",
    );
    await operator.start(stateDirectory, (message) =>
      process.stderr.write(message + "\n"),
    );
    return { state: "stopped", configFile, planFile, stateDirectory };
  } catch (error) {
    ui.note(
      `Configuration remains at ${configFile}.\nNothing is automatically retried. After inspecting any partial operation, use:\npnpm clawscarf plan --config ${quote(configFile)} --output ${quote(join(directory, "next-preview.json"))}\nReview that preview before apply.`,
      "Continue with the CLI",
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
  clack.log.info("Choose a starting point, then review your settings.");
  try {
    const result = await installFromAnswers(
      options,
      terminalPrompts,
      operations,
      progress,
    );
    if (result.state === "cancelled")
      clack.cancel("Cancelled. No installation files or resources created.");
    else
      clack.outro(
        result.state === "saved"
          ? "Configuration and preview saved. No runtime resources created."
          : result.state === "prepared"
            ? "Prepared. Start it when ready."
            : "Installation stopped; data retained.",
      );
  } catch (error) {
    if (
      !(error instanceof InstallerCancelled) &&
      !(error instanceof SectionCancelled)
    )
      throw error;
    clack.cancel(
      "Cancelled. Any saved files remain; no operation will be replayed.",
    );
    process.exitCode = 130;
  }
}
