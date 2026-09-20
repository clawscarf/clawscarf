import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { packageOperator } from "./release/operator.js";

await new Command("package-operator")
  .requiredOption("--output <directory>", "New artifact directory")
  .option(
    "--runtime <file>",
    "Publishable runtime definition with registry digests and tool downloads",
  )
  .action(async (options: { output: string; runtime?: string }) => {
    const artifact = await packageOperator(
      fileURLToPath(new URL("..", import.meta.url)),
      options.output,
      options.runtime,
    );
    process.stdout.write(`${artifact}\n`);
  })
  .parseAsync();
