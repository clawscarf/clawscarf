import { z } from "zod";
import { selectedDraft, type ConfigureOptions } from "../options.js";
import { setupContext } from "../setup.js";
import { validateSelections } from "../configure.js";
import { registerWithBrowser, registerUnattended } from "./cloud.js";
import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { collectInstallation } from "./collect.js";
import { progress, type InstallerPrompts } from "./prompts.js";
import { SetupInputs, saveConfiguration } from "../save.js";
import { readJson } from "../files.js";
import { installationSchema } from "../configuration.js";
import { planSettingsChange, reconfigureInstallation } from "../reconfigure.js";
import { controlInstallation, startInstallation } from "../lifecycle.js";
import { InstallationError } from "../errors.js";
import { withInstallationLock, writePrivate } from "../../deployment/state.js";

/** The menu only gathers answers; the same plan/apply operations serve unattended callers. */
export async function editInstallationSettings(
  directory: string,
  ui: InstallerPrompts,
  options: ConfigureOptions = {},
) {
  directory = resolve(directory);
  if (options.recipe || options.release || options.cloudUrl)
    throw new InstallationError(
      "change_unsupported",
      "Existing installations keep their recipe, software release and login service. Change models, keys, Connections or packs instead.",
    );
  if (options.nonInteractive && !options.yes)
    throw new InstallationError(
      "invalid_configuration",
      "Changing an existing installation noninteractively requires --yes. The server may restart and deselected packs may be removed.",
    );
  const task: typeof progress = (message, work) =>
    progress(message, work, options);
  const settingsFile = join(directory, "settings.json");
  const before = await readFile(settingsFile, "utf8");
  const config = installationSchema.parse(JSON.parse(before));
  const pending = z
    .object({ settingsCandidate: z.string().optional() })
    .parse(await readJson(join(directory, "prepared.json"))).settingsCandidate;
  if (
    pending &&
    (dirname(dirname(pending)) !== directory ||
      !/^\.settings-[a-f0-9-]+$/u.test(
        dirname(pending).slice(directory.length + 1),
      ))
  )
    throw new InstallationError(
      "invalid_configuration",
      "The pending configuration does not belong to this installation.",
    );
  const staging = pending
    ? dirname(pending)
    : join(directory, `.settings-${randomUUID()}`);
  const inputs = new SetupInputs(staging);
  let attempted = false;
  let authorizing: string | undefined;
  let retained = Boolean(pending);
  try {
    const context = await setupContext({ release: config.releaseFile });
    const selected = await selectedDraft(
      context,
      config.recipe?.id ?? "custom",
      options,
      inputs,
      config,
    );
    if (pending && JSON.stringify(selected) !== JSON.stringify(config))
      throw new InstallationError(
        "change_unsupported",
        "Resume the interrupted configuration without new selections first.",
      );
    const draft = pending
      ? undefined
      : options.nonInteractive
        ? { config: await validateSelections(context, selected) }
        : await collectInstallation(
            ui,
            { release: config.releaseFile, existing: true },
            { directory: staging, config: selected, inputs },
          );
    if ((await readFile(settingsFile, "utf8")) !== before)
      throw new InstallationError(
        "stale_plan",
        "Settings changed while this menu was open. Reopen it before applying.",
      );
    const candidate =
      pending ??
      (await saveConfiguration(
        staging,
        installationSchema.parse(draft?.config),
        inputs,
        true,
      ));
    if (
      pending &&
      !options.nonInteractive &&
      !(await ui.confirm("Resume this interrupted change?"))
    ) {
      await withInstallationLock(directory, async () => {
        const prepared = z
          .object({
            ownerId: z.string(),
            settingsCandidate: z.string().optional(),
            settingsPending: z.string().optional(),
          })
          .parse(await readJson(join(directory, "prepared.json")));
        if (prepared.settingsCandidate !== pending)
          throw new InstallationError(
            "stale_plan",
            "The pending change has changed. Reopen configure.",
          );
        if (!prepared.settingsPending) {
          await writePrivate(
            join(directory, "prepared.json"),
            JSON.stringify({ ownerId: prepared.ownerId }),
          );
          retained = false;
        }
      });
      return { state: "cancelled" as const };
    }
    authorizing = candidate;
    if (options.nonInteractive)
      await registerUnattended(candidate, options.cloudCredentialFile);
    else await registerWithBrowser(candidate, ui, task);
    authorizing = undefined;
    const plan = await planSettingsChange(candidate);
    ui.note(
      `Reapply models and selected Connections settings. Keep individual model overrides and unrelated native settings.
Connections: ${plan.changes.connections.from} → ${plan.changes.connections.to}
Packs: ${plan.changes.packs.selected.join(", ") || "none"}${plan.changes.packs.removed.length ? "\nRemove pack agents (including native-owned workspace/session data): " + plan.changes.packs.removed.join(", ") : ""}
The server must stop. Pack changes finish at the next start.`,
      "Review change",
    );
    if (
      !pending &&
      !options.nonInteractive &&
      !(await ui.confirm("Apply these settings?"))
    )
      return { state: "cancelled" as const };
    attempted = true;
    const current = await controlInstallation(directory, "status");
    if (current.state !== "stopped") {
      await task("Stopping ClawScarf", async (signal) => {
        await controlInstallation(directory, "stop");
        const deadline = Date.now() + 120_000;
        while (
          (await controlInstallation(directory, "status")).state !== "stopped"
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
    await task("Applying settings", () =>
      reconfigureInstallation(candidate, plan.fingerprint),
    );
    // Only our preceding accepted menu draft is retired. Never remove user-supplied inputs.
    const previousInputs = dirname(config.models.configurationFile);
    if (
      previousInputs !== staging &&
      dirname(previousInputs) === directory &&
      /^\.settings-[a-f0-9-]+$/u.test(
        previousInputs.slice(directory.length + 1),
      )
    )
      await rm(previousInputs, { recursive: true });
    if (
      options.start ??
      (options.nonInteractive
        ? true
        : await ui.confirm("Start with these settings?", true))
    ) {
      return task("Starting ClawScarf", (_signal, report) =>
        startInstallation(directory, report),
      );
    }
    ui.note(
      `clawscarf start --directory '${resolve(options.directory ?? dirname(directory)).replaceAll("'", "'\\''")}'`,
      "Start later",
    );
    return { state: "prepared" as const };
  } catch (error) {
    if (authorizing && !pending) {
      const candidate = authorizing;
      await withInstallationLock(directory, async () => {
        if ((await readFile(settingsFile, "utf8")) !== before)
          throw new InstallationError(
            "stale_plan",
            "Settings changed during authorization. Reopen configure before applying.",
          );
        const prepared = z
          .object({
            ownerId: z.string(),
            settingsCandidate: z.string().optional(),
            settingsPending: z.string().optional(),
          })
          .parse(await readJson(join(directory, "prepared.json")));
        if (prepared.settingsCandidate || prepared.settingsPending)
          throw new InstallationError(
            "stale_plan",
            "Another configuration is pending. Resume it before applying these settings.",
          );
        await writePrivate(
          join(directory, "prepared.json"),
          JSON.stringify({ ...prepared, settingsCandidate: candidate }),
        );
        retained = true;
      });
    }
    if (attempted)
      ui.note(
        "Check status, then run configure --directory again to review and resume the interrupted change.",
        "Retained settings",
      );
    throw error;
  } finally {
    if (!attempted && !retained)
      await rm(staging, { recursive: true, force: true });
  }
}
