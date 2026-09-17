import { packsCommand } from "./packs/command.js";

await packsCommand()
  .name("clawscarf-packs")
  .option("--json", "Print machine-readable results")
  .parseAsync();
