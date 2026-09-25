import { checkHost, checkInstallationPrerequisites } from "../prerequisites.js";
import { selectedDraft, type ConfigureOptions } from "../options.js";
import { setupContext } from "../setup.js";
import {
  configurationChanges,
  resolveConfigurationInputs,
  validateSelections,
} from "../configure.js";
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
import {
  planSettingsChange,
  reconfigureInstallation,
  retainSettingsAuthorization,
  discardSettingsCandidate,
} from "../reconfigure.js";
import { controlInstallation, startInstallation } from "../lifecycle.js";
import { InstallationError } from "../errors.js";
import { readPreparation } from "../../deployment/state.js";
import { changeAiSetup, type AiSetupResult } from "./billing.js";

/** The menu only gathers answers; the same plan/apply operations serve unattended callers. */
export async function editInstallationSettings(
  directory: string,
  ui: InstallerPrompts,
  options: ConfigureOptions = {},
  prerequisites = { host: checkHost, check: checkInstallationPrerequisites },
) {
  directory = resolve(directory);
  if (options.recipe || options.cloudUrl)
    throw new InstallationError(
      "change_unsupported",
      "Existing installations keep their recipe, software release and login service. Change models, keys, Connections, browser, public web or packs instead.",
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
  const record = await readPreparation(directory);
  const pending = record.settingsCandidate;
  if (
    record.settingsReapply &&
    options.reapply &&
    record.settingsReapply !== options.reapply
  )
    throw new InstallationError(
      "change_unsupported",
      "Resume the pending change before selecting another capability.",
    );
  const reapply = options.reapply ?? record.settingsReapply;
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
  let aiSetup: AiSetupResult | undefined;
  try {
    const context = await setupContext(
      config.models.mode === "litellm" && config.models.cloud
        ? { cloudUrl: config.models.cloud.url }
        : config.access.mode === "hosted"
          ? { cloudUrl: config.access.cloudUrl }
          : {},
      config.releaseFile,
    );
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
            { existing: true },
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
      retained = !(await discardSettingsCandidate(directory, pending));
      return { state: "cancelled" as const };
    }
    const changes = await configurationChanges(
      config,
      resolveConfigurationInputs(
        installationSchema.parse(await readJson(candidate)),
        dirname(candidate),
      ),
    );
    if (!pending && !reapply && !Object.values(changes).some(Boolean))
      return { state: "unchanged" as const };
    await task("Checking this machine", (_signal, report) =>
      prerequisites.host(undefined, report),
    );
    await task("Preparing required software", (signal, report) =>
      prerequisites.check(candidate, {
        acquire: true,
        signal,
        report,
      }),
    );
    // Local capabilities do not require another Cloud sign-in or AI purchase.
    if (changes.models || changes.connections || reapply) {
      authorizing = candidate;
      for (;;) {
        aiSetup = options.nonInteractive
          ? await registerUnattended(
              candidate,
              options.cloudCredentialFile,
              undefined,
              options,
            )
          : await registerWithBrowser(candidate, ui, task, undefined, options);
        if (aiSetup !== "change") break;
        await changeAiSetup(candidate, ui);
      }
      authorizing = undefined;
    }
    const plan = await planSettingsChange(candidate, reapply);
    ui.note(
      [
        ...(plan.scopes.models && plan.changes.models
          ? [
              `Model: ${plan.changes.models.default ?? "None"} · ${plan.changes.models.reasoning}`,
            ]
          : []),
        ...(plan.scopes.connections
          ? [
              `Connections: ${plan.changes.connections.to === "disabled" ? "Off" : "On"}`,
            ]
          : []),
        ...(plan.scopes.publicWeb
          ? [`Public web: ${plan.changes.publicWeb.to ? "On" : "Off"}`]
          : []),
        ...(plan.scopes.browser
          ? [
              `Browser: ${plan.changes.browser.to ? "On · Shared team browser" : "Off · Saved browser sessions kept"}`,
            ]
          : []),
        ...(plan.scopes.packs
          ? [`Packs: ${plan.changes.packs.selected.join(", ") || "None"}`]
          : []),
        ...(plan.changes.packs.removed.length
          ? [
              `Remove pack agents and native-owned data: ${plan.changes.packs.removed.join(", ")}`,
            ]
          : []),
        "The server will stop to apply these changes.",
      ].join("\n"),
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
      reconfigureInstallation(candidate, plan.fingerprint, reapply),
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
      const result = await task("Starting ClawScarf", (signal, report) =>
        startInstallation(directory, report, signal),
      );
      return {
        ...result,
        ...(aiSetup === "deferred" ? { aiReady: false } : {}),
      };
    }
    ui.note(
      `clawscarf start --directory '${resolve(options.directory ?? dirname(directory)).replaceAll("'", "'\\''")}'`,
      "Start later",
    );
    return {
      state: "prepared" as const,
      ...(aiSetup === "deferred" ? { aiReady: false } : {}),
    };
  } catch (error) {
    if (authorizing && !pending) {
      await retainSettingsAuthorization(
        directory,
        authorizing,
        before,
        reapply,
      );
      retained = true;
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
