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
import { allocatePorts, resolveInstallation } from "./resolve.js";
import { upgradeLocal } from "../local/upgrade.js";
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
    .option("--release <file>", "Explicit ClawScarf release file")
    .option("--directory <path>", "New private installation directory")
    .action(runInstaller);
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
    .requiredOption("--service <name>")
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
  return program;
}
