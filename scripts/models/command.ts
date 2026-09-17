import { writeResult } from "../output.js";
import { configureRuntimeModels } from "./runtime.js";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { configureNativeModels, loadConfiguration } from "./native.js";
import { liteLlmConfiguration } from "./configuration.js";
import {
  issueRuntimeCredential,
  revokeRuntimeCredential,
} from "./credentials.js";
export function modelsCommand() {
  const program = new Command("models").description(
    "Configure native model routing; upstream credentials stay in the gateway.",
  );
  program
    .command("render")
    .requiredOption("--config <file>")
    .requiredOption("--output <file>", "New LiteLLM configuration file")
    .action(async (options: { config: string; output: string }) => {
      const config = await loadConfiguration(options.config);
      await writeFile(
        options.output,
        `${JSON.stringify(liteLlmConfiguration(config), null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      writeResult(
        program,
        { state: "created", file: options.output },
        "Gateway configuration written.",
      );
    });
  program
    .command("configure")
    .requiredOption("--config <file>")
    .option("--openclaw <executable>", "Pinned native CLI", "openclaw")
    .option(
      "--yes",
      "Replace the selected provider/default paths; otherwise validate only",
    )
    .action(
      async (options: { config: string; openclaw: string; yes?: boolean }) => {
        const result = await configureNativeModels(
          options.openclaw,
          await loadConfiguration(options.config),
          options.yes === true,
        );
        writeResult(program, result);
      },
    );
  program
    .command("configure-runtime")
    .requiredOption("--config <file>")
    .requiredOption("--openshell <executable>")
    .requiredOption("--sandbox <name>")
    .requiredOption("--gateway <name>")
    .requiredOption("--key-file <file>", "Scoped runtime key only")
    .option("--ca-file <file>", "Public CA certificate for the private gateway")
    .option(
      "--yes",
      "Replace selected native settings; otherwise validate only",
    )
    .action(
      async (options: {
        config: string;
        openshell: string;
        sandbox: string;
        gateway: string;
        keyFile: string;
        caFile?: string;
        yes?: boolean;
      }) => {
        const state = await configureRuntimeModels({
          ...options,
          configuration: await loadConfiguration(options.config),
          apply: options.yes === true,
        });
        writeResult(
          program,
          { state },
          state === "configured_restart_required"
            ? "Configured. Restart the Gateway to load the changed CA trust."
            : state,
        );
      },
    );
  program
    .command("issue-key")
    .requiredOption("--config <file>")
    .requiredOption("--origin <url>", "Private LiteLLM management origin")
    .requiredOption("--master-key-file <file>")
    .option(
      "--ca-file <file>",
      "CA certificate for private LiteLLM management TLS",
    )
    .requiredOption(
      "--output <file>",
      "New private file receiving only the runtime key",
    )
    .action(
      async (options: {
        config: string;
        origin: string;
        masterKeyFile: string;
        caFile?: string;
        output: string;
      }) => {
        await issueRuntimeCredential({
          ...options,
          configuration: await loadConfiguration(options.config),
        });
        writeResult(
          program,
          { state: "created", file: options.output },
          "Runtime key written to the private output file.",
        );
      },
    );
  program
    .command("revoke-key")
    .requiredOption("--origin <url>")
    .requiredOption("--master-key-file <file>")
    .option(
      "--ca-file <file>",
      "CA certificate for private LiteLLM management TLS",
    )
    .requiredOption("--key-file <file>")
    .option("--yes", "Revoke this runtime credential")
    .action(
      async (options: {
        origin: string;
        masterKeyFile: string;
        caFile?: string;
        keyFile: string;
        yes?: boolean;
      }) => {
        if (!options.yes) throw Error("Explicit --yes is required.");
        await revokeRuntimeCredential(options);
        writeResult(program, { state: "revoked" }, "Runtime key revoked.");
      },
    );
  return program;
}
