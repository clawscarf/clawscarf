import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { packageOperator } from "./release/operator.js";

await new Command("package-operator")
  .requiredOption("--output <directory>", "New artifact directory")
  .action(async (options: { output: string }) => {
    const artifact = await packageOperator(
      fileURLToPath(new URL("..", import.meta.url)),
      options.output,
    );
    process.stdout.write(`${artifact}\n`);
  })
  .parseAsync();
