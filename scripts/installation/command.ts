import { connectionCommands } from "../connections.js";
import { peopleCommand } from "../people.js";
import { confirmDeletion, deleteInstallation } from "./delete.js";
import { writeResult } from "../output.js";
import { createDevelopmentRelease } from "../release/create.js";
import { Command, Option } from "commander";
import { z } from "zod";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installationSchema } from "./configuration.js";
import { readJson } from "./files.js";
import {
  startInstallation,
  controlInstallation,
  installationLogs,
} from "./lifecycle.js";
import { doctorInstallation } from "./doctor.js";
import { localLogNames } from "../deployment/logs.js";
import { upgradeLocal } from "../deployment/upgrade.js";
import { setupContext, type SetupOptions } from "./setup.js";
import { progress } from "./installer/prompts.js";
import { runConfiguration } from "./installer/run.js";
import { installationOptions, type ConfigureOptions } from "./options.js";
import { InstallationError } from "./errors.js";
import { administratorSetup } from "./administrator.js";

export function installationCommand() {
  const program = new Command("clawscarf")
    .description("Install and operate a protected OpenClaw team server.")
    .option(
      "--json",
      "Print machine-readable results; diagnostics go to stderr",
    );
  program.addCommand(peopleCommand(program));
  const output = (value: unknown, human?: string) => {
    writeResult(program, value, human);
  };
  installationOptions(program.command("configure"))
    .description(
      "Create or change an installation; prompts unless --non-interactive",
    )
    .option("--directory <path>", "Installation directory")
    .option("--recipe <id>", "New installation: release recipe ID, or custom")
    .option(
      "--release <file>",
      "Development override: local software release bundle",
    )
    .option("--cloud-url <url>", "Development override: ClawScarf Cloud origin")
    .option(
      "--cloud-credential-file <file>",
      "Private cloud credential for unattended registration",
    )
    .option("--non-interactive", "Use explicit options without prompting")
    .option(
      "--yes",
      "Approve changes to an existing installation, including a restart",
    )
    .addOption(
      new Option(
        "--reapply <capability>",
        "Explicitly restore selected managed settings on an existing installation",
      ).choices(["models", "connections"]),
    )
    .option("--start", "Start after configuration")
    .option("--no-start", "Leave the installation stopped")
    .action(async (options: ConfigureOptions) => {
      const result = await runConfiguration({
        ...options,
        ...program.opts<{ json?: boolean }>(),
      });
      if (options.nonInteractive) output(result);
    });
  program
    .command("recipes")
    .description("List the release's recipe defaults")
    .option("--release <file>")
    .action(async (options: SetupOptions) => {
      const context = await setupContext(options);
      output({
        release: context.release.version,
        recipes: context.recipes,
        models: context.release.modelCatalog,
        packs: context.release.packs,
        custom: true,
      });
    });
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
  withLocation(program.command("start")).action(
    async (options: LocationOptions) => {
      const state = await resolveLocation(options);
      const result = await progress(
        "Starting ClawScarf",
        (signal, report) => startInstallation(state, report, signal),
        program.opts<{ json?: boolean }>(),
      );
      output(result, statusText(result));
    },
  );
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
  for (const action of ["status", "stop"] as const) {
    const command = withLocation(program.command(action));
    if (action === "stop")
      command
        .option(
          "--delete",
          "Permanently delete this installation's Docker resources and data",
        )
        .option(
          "--confirm-delete <directory>",
          "Unattended deletion: confirm the exact absolute installation directory",
        )
        .option(
          "--accept-data-loss",
          "Unattended deletion: acknowledge permanent loss of all installation data",
        );
    command.action(
      async (
        options: LocationOptions & {
          delete?: boolean;
          confirmDelete?: string;
          acceptDataLoss?: boolean;
        },
      ) => {
        if (options.delete) {
          await confirmDeletion(resolve(options.directory), {
            ...options,
            ...program.opts<{ json?: boolean }>(),
          });
          const directory = await resolveLocation(options);
          const result = await progress(
            "Deleting installation",
            (signal) => deleteInstallation(directory, signal),
            program.opts<{ json?: boolean }>(),
          );
          output(
            result,
            "Installation deleted from Docker. You can now remove its installation folder.",
          );
          return;
        }
        if (options.confirmDelete !== undefined || options.acceptDataLoss)
          throw new InstallationError(
            "invalid_configuration",
            "Deletion confirmations require --delete.",
          );
        const result = await controlInstallation(
          await resolveLocation(options),
          action,
        );
        output(result, statusText(result));
      },
    );
  }
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
  withLocation(program.command("doctor")).action(
    async ({ directory }: LocationOptions) => {
      const accepted = join(
        await resolveLocation({ directory }),
        "settings.json",
      );
      let config = accepted;
      try {
        await access(accepted);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
        config = join(resolve(directory), "installation.json");
      }
      output(await doctorInstallation(config));
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
    .description("Manage connected accounts and their agent access");
  connectionCommands(connections, program);
  return program;
}

function statusText(status: Awaited<ReturnType<typeof controlInstallation>>) {
  const lines = [
    `Server: ${status.state}`,
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

type LocationOptions = { directory: string };
function withLocation(command: Command) {
  return command.requiredOption(
    "--directory <path>",
    "Installation directory selected during configure",
  );
}

/** Read only the location contract so stop/delete still work with invalid startup settings. */
async function resolveLocation({ directory }: LocationOptions) {
  const config = z
    .object({ stateDirectory: installationSchema.shape.stateDirectory })
    .parse(await readJson(join(resolve(directory), "installation.json")));
  return resolve(directory, config.stateDirectory);
}
