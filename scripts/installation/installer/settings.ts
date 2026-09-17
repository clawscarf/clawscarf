import * as clack from "@clack/prompts";
import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { collectInstallation } from "./collect.js";
import {
  InstallerCancelled,
  SectionCancelled,
  progress,
  requireTerminal,
  terminalPrompts,
  type InstallerPrompts,
} from "./prompts.js";
import { SetupInputs, saveConfiguration } from "../save.js";
import { readJson } from "../files.js";
import { installationSchema } from "../configuration.js";
import { planSettingsChange, reconfigureInstallation } from "../reconfigure.js";
import { controlInstallation, startInstallation } from "../lifecycle.js";
import { InstallationError } from "../errors.js";

export async function readInstallationSettings(directory: string) {
  return installationSchema.parse(
    await readJson(join(resolve(directory), "settings.json")),
  );
}

/** The menu only gathers answers; the same plan/apply operations serve unattended callers. */
export async function editInstallationSettings(
  directory: string,
  ui: InstallerPrompts,
) {
  directory = resolve(directory);
  const settingsFile = join(directory, "settings.json");
  const before = await readFile(settingsFile, "utf8");
  const config = installationSchema.parse(JSON.parse(before));
  const staging = join(directory, `.settings-${randomUUID()}`);
  const inputs = new SetupInputs(staging);
  let attempted = false;
  try {
    const draft = await collectInstallation(
      ui,
      { release: config.releaseFile, existing: true },
      {
        directory: staging,
        config,
        inputs,
      },
    );
    if ((await readFile(settingsFile, "utf8")) !== before)
      throw new InstallationError(
        "stale_plan",
        "Settings changed while this menu was open. Reopen it before applying.",
      );
    const candidate = await saveConfiguration(
      staging,
      installationSchema.parse(draft.config),
      inputs,
      true,
    );
    const plan = await planSettingsChange(candidate);
    ui.note(
      `Reapply models and selected Connections settings. Keep individual model overrides and unrelated native settings.
Connections: ${plan.changes.connections.from} → ${plan.changes.connections.to}
Packs: ${plan.changes.packs.selected.join(", ") || "none"}${plan.changes.packs.removed.length ? "\nRemove pack agents (including native-owned workspace/session data): " + plan.changes.packs.removed.join(", ") : ""}
The server must stop. Pack changes finish at the next start.`,
      "Review change",
    );
    if (!(await ui.confirm("Apply these settings?"))) return;
    attempted = true;
    const current = await controlInstallation(directory, "status");
    if (current.supervisor !== "not_running") {
      await progress("Stopping ClawScarf", async (signal) => {
        await controlInstallation(directory, "stop");
        const deadline = Date.now() + 120_000;
        while (
          (await controlInstallation(directory, "status")).supervisor !==
          "not_running"
        ) {
          if (Date.now() >= deadline)
            throw new InstallationError(
              "unavailable",
              "Shutdown is not yet confirmed. Check status before applying settings.",
            );
          await delay(500, undefined, { signal });
        }
      });
    }
    await progress("Applying settings", () =>
      reconfigureInstallation(candidate, plan.fingerprint),
    );
    // Only our preceding accepted menu draft is retired. Never remove user-supplied inputs.
    const previousInputs = dirname(config.models.configurationFile);
    if (
      dirname(previousInputs) === directory &&
      /^\.settings-[a-f0-9-]+$/u.test(
        previousInputs.slice(directory.length + 1),
      )
    )
      await rm(previousInputs, { recursive: true });
    if (await ui.confirm("Start with these settings?"))
      await progress("Starting ClawScarf", () =>
        startInstallation(directory, (message) => {
          ui.note(message, "Startup");
        }),
      );
    else
      ui.note(
        `pnpm clawscarf start --state '${directory.replaceAll("'", "'\\''")}'`,
        "Start later",
      );
  } catch (error) {
    if (attempted)
      ui.note(
        `Candidate: ${join(staging, "installation.json")}\nCheck status. If application was interrupted, review this same candidate with settings plan before an explicit settings apply.`,
        "Retained settings",
      );
    throw error;
  } finally {
    if (!attempted) await rm(staging, { recursive: true, force: true });
  }
}

export async function runSettings(directory: string) {
  requireTerminal();
  clack.intro("ClawScarf — installation settings");
  try {
    await editInstallationSettings(directory, terminalPrompts);
    clack.outro("Settings review finished.");
  } catch (error) {
    if (
      !(error instanceof InstallerCancelled) &&
      !(error instanceof SectionCancelled)
    )
      throw error;
    clack.cancel(
      "Exited. The installation and accepted settings are retained.",
    );
  }
}
