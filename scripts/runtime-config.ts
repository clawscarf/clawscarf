import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import {
  configurationInput,
  initialConfiguration,
} from "../runtime/configuration.js";

const command = new Command()
  .name("clawscarf-runtime-config")
  .description(
    "Create a fresh native configuration; never replace existing state.",
  )
  .requiredOption(
    "--input <file>",
    "JSON containing publicOrigin, widgetOrigin and administratorIdentity",
  )
  .requiredOption("--output <file>", "New native configuration file")
  .action(async (options: { input: string; output: string }) => {
    const input: unknown = JSON.parse(await readFile(options.input, "utf8"));
    const config = initialConfiguration(configurationInput.parse(input));
    await writeFile(options.output, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(
      "Created native configuration. Validate it with the pinned runtime before starting.\n",
    );
  });
await command.parseAsync();
