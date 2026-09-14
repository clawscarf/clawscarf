import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { NativeClaws } from "./packs/native.js";
import { inspectPack, planPack, applyPack } from "./packs/lifecycle.js";
import type { PackPlan } from "./packs/model.js";
const program = new Command("clawscarf-packs").option(
  "--openclaw <executable>",
  "native OpenClaw command",
  "openclaw",
);
const native = () =>
  new NativeClaws(
    program.opts<{ openclaw: string }>().openclaw,
    process.env.CLAWSCARF_PACK_RUNTIME !== "1",
  );
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
    .option("--bindings <path>")
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
  .option("--bindings <path>")
  .action(async (path: string, options: { bindings?: string }) => {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    print(await applyPack(value, native(), options.bindings));
  });
program.command("status <member>").action(async (member: string) => {
  await native().version();
  print(await native().run(["claws", "status", member, "--json"]));
});
await program.parseAsync();
