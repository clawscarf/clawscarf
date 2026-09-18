import { Command } from "commander";
import { NativeClaws } from "./packs/native.js";
import { inspectPack } from "./packs/lifecycle.js";

// Private runtime helper used by the installation operator.
await new Command("clawscarf-packs")
  .command("inspect <directory>")
  .requiredOption("--json")
  .action(async (directory: string) => {
    console.log(
      JSON.stringify(
        await inspectPack(directory, new NativeClaws("openclaw", false)),
      ),
    );
  })
  .parseAsync();
