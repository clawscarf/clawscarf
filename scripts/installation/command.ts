import { writeResult } from "../output.js";
import { modelsCommand } from "../models/command.js";
import { packsCommand } from "../packs/command.js";
import {
  configurationInput,
  initialConfiguration,
} from "../../runtime/configuration.js";
import { createDevelopmentRelease } from "../release/create.js";
import { Command } from "commander";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installationSchema } from "./configuration.js";
import { readJson } from "./files.js";
import { planInstallation, applyInstallation } from "./plan.js";
import {
  startInstallation,
  superviseInstallation,
  controlInstallation,
  installationLogs,
} from "./lifecycle.js";
import { doctorInstallation } from "./doctor.js";
import { localLoginCode } from "../local/login.js";
import { localLogNames } from "../local/logs.js";
import { allocatePorts, resolveInstallation } from "./resolve.js";
import { upgradeLocal } from "../local/upgrade.js";
import { configureInstallation } from "./configure.js";
import { setupContext, type SetupOptions } from "./setup.js";
import { operateConnectionsRuntime } from "../local/connections-runtime.js";
import { progress } from "./installer/prompts.js";
import { runInstaller } from "./installer/run.js";
import { planSettingsChange, reconfigureInstallation } from "./reconfigure.js";
import { runSettings, readInstallationSettings } from "./installer/settings.js";
import { InstallationError } from "./errors.js";
import { administratorSetup } from "./administrator.js";

export function installationCommand() {
  const program = new Command("clawscarf")
    .description("Install and operate a protected OpenClaw team server.")
    .option(
      "--json",
      "Print machine-readable results; diagnostics go to stderr",
    );
  const output = (value: unknown, human?: string) => {
    writeResult(program, value, human);
  };
  program
    .command("install")
    .description(
      "Interactively configure and optionally start a new installation",
    )
    .option(
      "--release <file>",
      "Developer override: local ClawScarf release file",
    )
    .option(
      "--recipes <directory>",
      "Developer override: local recipe catalogue",
    )
    .option("--recipe <id>", "Starting recipe, or custom")
    .option("--directory <path>", "New private installation directory")
    .option(
      "--settings <file>",
      "JSON overrides; skip questions already answered here",
    )
    .action(async (options: Parameters<typeof runInstaller>[0]) => {
      if (program.opts<{ json?: boolean }>().json)
        throw new InstallationError(
          "invalid_configuration",
          "Use configure for noninteractive setup; install requires a terminal.",
        );
      await runInstaller(options);
    });
  program
    .command("recipes")
    .description("List the release's recipe defaults")
    .option("--release <file>")
    .option("--recipes <directory>")
    .action(async (options: SetupOptions) => {
      const context = await setupContext(options);
      output({
        release: context.release.version,
        recipes: context.recipes,
        custom: true,
      });
    });
  program
    .command("configure")
    .description(
      "Write a new installation configuration without prompts or provisioning",
    )
    .option("--release <file>")
    .option("--recipes <directory>")
    .requiredOption("--recipe <id>", "Recipe ID, or custom")
    .requiredOption("--directory <path>", "New private installation directory")
    .option(
      "--settings <file>",
      "JSON section overrides; input paths are relative to this file",
    )
    .action(
      async (
        options: SetupOptions & {
          recipe: string;
          directory: string;
          settings?: string;
        },
      ) => {
        output(await configureInstallation(options));
      },
    );
  program
    .command("release-create")
    .description(
      "Bundle a development release from already-built component inputs",
    )
    .requiredOption("--input <file>")
    .requiredOption("--output <directory>")
    .action(async (options: { input: string; output: string }) => {
      const release = await createDevelopmentRelease({
        inputFile: options.input,
        outputDirectory: options.output,
      });
      output({ version: release.version, directory: options.output });
    });
  program
    .command("validate")
    .requiredOption("--config <file>")
    .action(async ({ config }: { config: string }) => {
      const result = await resolveInstallation(config, await allocatePorts());
      output({ valid: true, release: result.release.version });
    });
  program
    .command("plan")
    .requiredOption("--config <file>")
    .option("--output <file>", "Write a new private preview for apply")
    .action(async (options: { config: string; output?: string }) => {
      const plan = await planInstallation(options.config);
      if (options.output)
        await writeFile(options.output, JSON.stringify(plan, null, 2) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
      output(plan);
    });
  program
    .command("apply")
    .requiredOption("--config <file>")
    .requiredOption("--plan <file>")
    .requiredOption("--yes", "Apply this exact preview")
    .action(async (options: { config: string; plan: string }) => {
      output(await applyInstallation(options.config, options.plan));
    });
  const settings = withLocation(program.command("settings"))
    .description(
      "View, edit or explicitly reapply this installation's settings",
    )
    .action(async (options: LocationOptions) => {
      const state = await resolveLocation(options);
      if (settings.optsWithGlobals<{ json?: boolean }>().json)
        writeResult(settings, await readInstallationSettings(state));
      else await runSettings(state);
    });
  settings
    .command("plan")
    .requiredOption("--config <file>", "Candidate installation configuration")
    .action(async ({ config }: { config: string }) => {
      const plan = await planSettingsChange(config);
      output({
        stateDirectory: plan.directory,
        fingerprint: plan.fingerprint,
        restartRequired: true,
        resuming: plan.resuming,
        changes: plan.changes,
      });
    });
  settings
    .command("apply")
    .requiredOption("--config <file>")
    .requiredOption(
      "--fingerprint <digest>",
      "Fingerprint returned by settings plan",
    )
    .requiredOption("--yes", "Apply the reviewed settings")
    .action(
      async ({
        config,
        fingerprint,
      }: {
        config: string;
        fingerprint: string;
      }) => {
        output(await reconfigureInstallation(config, fingerprint));
      },
    );
  withLocation(program.command("start"))
    .option("--foreground", "Developer: run the supervisor in this terminal")
    .action(async (options: LocationOptions & { foreground?: boolean }) => {
      const state = await resolveLocation(options);
      const { foreground } = options;
      if (foreground) {
        await superviseInstallation(state, (message) => {
          process.stderr.write(message + "\n");
        });
        return;
      }
      const result = await progress(
        "Starting ClawScarf",
        (_signal, report) => startInstallation(state, report),
        program.opts<{ json?: boolean }>(),
      );
      output(result, statusText(result));
    });
  withLocation(program.command("administrator"))
    .description("Observe or issue the private first-administrator setup link")
    .option(
      "--issue",
      "Replace the pending setup link; cannot reclaim an initialized server",
    )
    .action(async (options: LocationOptions & { issue?: boolean }) => {
      output(
        await administratorSetup(await resolveLocation(options), options.issue),
      );
    });
  for (const action of ["status", "stop"] as const)
    withLocation(program.command(action)).action(
      async (options: LocationOptions) => {
        const result = await controlInstallation(
          await resolveLocation(options),
          action,
        );
        output(result, statusText(result));
      },
    );
  withLocation(program.command("logs"))
    .requiredOption("--service <name>", localLogNames.join(", "))
    .action(async (options: LocationOptions & { service: string }) => {
      const { service } = options;
      const text = await installationLogs(
        await resolveLocation(options),
        service,
      );
      if (program.opts<{ json?: boolean }>().json) output({ service, text });
      else process.stdout.write(text);
    });
  program
    .command("doctor")
    .requiredOption("--config <file>")
    .action(async ({ config }: { config: string }) => {
      output(await doctorInstallation(config));
    });
  withLocation(program.command("login")).action(
    async (options: LocationOptions) => {
      output(await localLoginCode(await resolveLocation(options)));
    },
  );
  withLocation(program.command("upgrade"))
    .requiredOption("--runtime-image <digest>")
    .requiredOption("--python <executable>")
    .requiredOption("--yes")
    .action(
      async (
        options: LocationOptions & {
          runtimeImage: string;
          python: string;
        },
      ) => {
        await upgradeLocal(
          await resolveLocation(options),
          options.runtimeImage,
          options.python,
          (message) => {
            process.stderr.write(message + "\n");
          },
        );
        output({ state: "upgraded" }, "Upgrade completed.");
      },
    );
  const connections = program
    .command("connections")
    .description(
      "Observe or explicitly configure the stopped native Connections integration",
    );
  withLocation(connections.command("observe")).action(
    async (options: LocationOptions) => {
      output(
        await operateConnectionsRuntime(await resolveLocation(options), {
          kind: "observe",
        }),
      );
    },
  );
  withLocation(connections.command("configure"))
    .requiredOption(
      "--credential-file <path>",
      "Private file containing the scoped broker token",
    )
    .requiredOption(
      "--yes",
      "Replace only the Connections endpoint and credential; preserve native disablement and other settings",
    )
    .action(async (options: LocationOptions & { credentialFile: string }) => {
      output(
        await operateConnectionsRuntime(await resolveLocation(options), {
          kind: "configure",
          credentialFile: options.credentialFile,
        }),
      );
    });
  program.addCommand(modelsCommand());
  program.addCommand(packsCommand());
  program
    .command("config")
    .description("Render native configuration from an explicit preset")
    .command("render-native")
    .requiredOption("--input <file>", "Preset JSON")
    .requiredOption("--output <file>", "New native configuration file")
    .action(async (options: { input: string; output: string }) => {
      const config = initialConfiguration(
        configurationInput.parse(
          JSON.parse(await readFile(options.input, "utf8")),
        ),
      );
      await writeFile(options.output, JSON.stringify(config, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      output({ state: "created", file: options.output });
    });
  return program;
}

function statusText(status: Awaited<ReturnType<typeof controlInstallation>>) {
  const lines = [
    `Server: ${status.supervisor === "not_running" ? "Stopped" : status.supervisor}`,
    `Ready: ${status.ready ? "Yes" : "No"}`,
  ];
  if ("administrator" in status) {
    lines.push(`Administrator: ${status.administrator}`);
    if (status.administrator === "pending")
      lines.push(
        "Complete administrator setup with clawscarf administrator --issue and your installation directory.",
      );
    for (const pack of status.packs)
      lines.push(`Pack ${pack.member}: ${pack.state}`);
  }
  return lines.join("\n");
}

type LocationOptions = { directory?: string; state?: string };
function withLocation(command: Command) {
  return command
    .option(
      "--directory <path>",
      "Installation directory selected during install",
    )
    .option("--state <path>", "Use the private state directory directly");
}

/** Lifecycle operators receive state, whichever public location option was used. */
async function resolveLocation({ directory, state }: LocationOptions) {
  if ((!directory && !state) || (directory && state))
    throw new InstallationError(
      "invalid_configuration",
      "Supply either --directory <installation> or --state <state-folder>.",
    );
  if (directory) {
    const config = z
      .object({ stateDirectory: installationSchema.shape.stateDirectory })
      .parse(await readJson(join(resolve(directory), "installation.json")));
    return resolve(directory, config.stateDirectory);
  }
  return resolve(state ?? "");
}
