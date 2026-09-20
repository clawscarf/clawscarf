import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  exportOpenClaw,
  prepareOpenClaw,
  verifyOpenClaw,
} from "./openclaw/patches.js";

const program = new Command("openclaw-patches").description(
  "Maintain ClawScarf's pinned OpenClaw source patches",
);
program
  .command("prepare")
  .requiredOption(
    "--directory <directory>",
    "New development or build checkout",
  )
  .option(
    "--source <repository>",
    "Git source/cache containing the pinned commit",
  )
  .option("--provenance <file>", "Write verified source provenance")
  .action(
    async (options: {
      directory: string;
      source?: string;
      provenance?: string;
    }) => {
      const result = await prepareOpenClaw(
        process.cwd(),
        resolve(options.directory),
        options.source,
      );
      if (options.provenance)
        await writeFile(
          options.provenance,
          JSON.stringify(result, null, 2) + "\n",
        );
      console.log(JSON.stringify(result, null, 2));
    },
  );
program
  .command("export")
  .requiredOption(
    "--directory <directory>",
    "Clean source checkout with the complete named patch series",
  )
  .action(async (options: { directory: string }) => {
    console.log(
      JSON.stringify(
        await exportOpenClaw(process.cwd(), options.directory),
        null,
        2,
      ),
    );
  });
program
  .command("verify")
  .option(
    "--source <repository>",
    "Git source/cache containing the pinned commit",
  )
  .action(async (options: { source?: string }) => {
    console.log(
      JSON.stringify(
        await verifyOpenClaw(process.cwd(), options.source),
        null,
        2,
      ),
    );
  });
await program.parseAsync();
