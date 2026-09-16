import { createDevelopmentRelease } from "../release/create.js";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planInstallation, applyInstallation } from "./plan.js";
import {
  startInstallation,
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
import { runInstaller } from "./installer/run.js";

const output = (value: unknown) => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};
export function installationCommand() {
  const program = new Command("clawscarf").description(
    "Install and operate a protected OpenClaw team server.",
  );
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
    .action(runInstaller);
  program
    .command("recipes")
    .description("List the release's recipe defaults as JSON")
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
      "Generate a development release from already-built component inputs",
    )
    .requiredOption("--input <file>")
    .requiredOption("--output <file>")
    .requiredOption("--version <version>")
    .requiredOption("--source-revision <sha>")
    .requiredOption("--openshell-version <version>")
    .action(
      async (options: {
        input: string;
        output: string;
        version: string;
        sourceRevision: string;
        openshellVersion: string;
      }) => {
        const release = await createDevelopmentRelease({
          inputFile: options.input,
          outputFile: options.output,
          version: options.version,
          sourceRevision: options.sourceRevision,
          openshellVersion: options.openshellVersion,
        });
        output({ version: release.version, file: options.output });
      },
    );
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
  program
    .command("start")
    .requiredOption("--state <directory>")
    .action(async ({ state }: { state: string }) =>
      startInstallation(state, (message) => {
        process.stderr.write(message + "\n");
      }),
    );
  for (const action of ["status", "stop"] as const)
    program
      .command(action)
      .requiredOption("--state <directory>")
      .action(async ({ state }: { state: string }) => {
        output(await controlInstallation(state, action));
      });
  program
    .command("logs")
    .requiredOption("--state <directory>")
    .requiredOption("--service <name>", localLogNames.join(", "))
    .action(async ({ state, service }: { state: string; service: string }) => {
      process.stdout.write(await installationLogs(state, service));
    });
  program
    .command("doctor")
    .requiredOption("--config <file>")
    .action(async ({ config }: { config: string }) => {
      output(await doctorInstallation(config));
    });
  program
    .command("login")
    .requiredOption("--state <directory>")
    .action(async ({ state }: { state: string }) => {
      output(await localLoginCode(resolve(state)));
    });
  program
    .command("upgrade")
    .requiredOption("--state <directory>")
    .requiredOption("--runtime-image <digest>")
    .requiredOption("--python <executable>")
    .requiredOption("--yes")
    .action(
      async (options: {
        state: string;
        runtimeImage: string;
        python: string;
      }) =>
        upgradeLocal(
          options.state,
          options.runtimeImage,
          options.python,
          (message) => {
            process.stderr.write(message + "\n");
          },
        ),
    );
  const connections = program
    .command("connections")
    .description(
      "Observe or explicitly configure the stopped native Connections integration",
    );
  connections
    .command("observe")
    .requiredOption(
      "--state <directory>",
      "Stopped private installation directory; start only its controller",
    )
    .action(async (options: { state: string }) => {
      output(
        await operateConnectionsRuntime(options.state, { kind: "observe" }),
      );
    });
  connections
    .command("configure")
    .requiredOption(
      "--state <directory>",
      "Stopped private installation directory; start only its controller",
    )
    .requiredOption(
      "--credential-file <path>",
      "Private file containing the scoped broker token",
    )
    .requiredOption(
      "--yes",
      "Replace only the Connections endpoint and credential; preserve native disablement and other settings",
    )
    .action(async (options: { state: string; credentialFile: string }) => {
      output(
        await operateConnectionsRuntime(options.state, {
          kind: "configure",
          credentialFile: options.credentialFile,
        }),
      );
    });
  return program;
}
