import { readFile, writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { OpenShellClaws } from "./openshell.js";
import { NativeClaws } from "./native.js";
import { inspectPack, planPack, applyPack } from "./lifecycle.js";
import type { PackPlan } from "./model.js";
export function packsCommand() {
  const program = new Command("packs").option(
    "--openclaw <executable>",
    "native OpenClaw command",
    "openclaw",
  );
  if (process.env.CLAWSCARF_PACK_RUNTIME !== "1") {
    program
      .option("--sandbox <name>", "OpenClaw Gateway sandbox")
      .option("--worker-sandbox <name>", "protected shared execution worker")
      .option("--gateway <name>", "OpenShell controller", "clawscarf")
      .option("--openshell <executable>", "OpenShell CLI", "openshell")
      .option(
        "--python <executable>",
        "operator Python with pinned OpenShell SDK",
        "python3",
      );
  }
  const native = () => {
    const options = program.opts<{
      sandbox?: string;
      workerSandbox?: string;
      gateway: string;
      openshell: string;
      python: string;
    }>();
    if (options.sandbox) {
      if (!options.workerSandbox)
        throw Error("Supply --worker-sandbox with --sandbox.");
      return new OpenShellClaws({
        executable: options.openshell,
        python: options.python,
        sandbox: options.sandbox,
        workerSandbox: options.workerSandbox,
        gateway: options.gateway,
      });
    }
    if (options.workerSandbox)
      throw Error("Supply --sandbox with --worker-sandbox.");
    return new NativeClaws(
      program.opts<{ openclaw: string }>().openclaw,
      process.env.CLAWSCARF_PACK_RUNTIME !== "1",
    );
  };
  const print = (value: unknown) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  program.command("inspect <directory>").action(async (directory: string) => {
    print(await inspectPack(directory, native()));
  });
  for (const operation of [
    "add",
    "update",
    "remove",
  ] satisfies PackPlan["operation"][]) {
    program
      .command(`${operation} <directory>`)
      .requiredOption("--member <id>")
      .requiredOption("--workspace <path>")
      .requiredOption("--plan <path>", "new reviewed-plan output file")
      .addOption(
        new Option("--bindings <path>").hideHelp(
          process.env.CLAWSCARF_PACK_RUNTIME === "1",
        ),
      )
      .action(
        async (
          directory: string,
          options: {
            member: string;
            workspace: string;
            plan: string;
            bindings?: string;
          },
        ) => {
          const plan = await planPack(
            {
              directory,
              operation,
              member: options.member,
              workspace: options.workspace,
              ...(options.bindings ? { bindingsFile: options.bindings } : {}),
            },
            native(),
          );
          await writeFile(options.plan, JSON.stringify(plan, null, 2) + "\n", {
            flag: "wx",
            mode: 0o600,
          });
          print(plan);
        },
      );
  }
  program
    .command("apply <plan>")
    .requiredOption("--yes", "apply the exact reviewed native plan")
    .addOption(
      new Option("--bindings <path>").hideHelp(
        process.env.CLAWSCARF_PACK_RUNTIME === "1",
      ),
    )
    .action(async (path: string, options: { bindings?: string }) => {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      print(await applyPack(value, native(), options.bindings));
    });
  program.command("status <member>").action(async (member: string) => {
    const target = native();
    await target.version();
    print(await target.run(["claws", "status", member, "--json"]));
  });
  return program;
}
