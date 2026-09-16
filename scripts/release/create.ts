import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { releaseSchema } from "./definition.js";

// Build inputs use the release contract, replacing tool digests with source paths.
const inputSchema = releaseSchema.extend({
  tools: z.strictObject({
    openshell: releaseSchema.shape.tools.shape.openshell.extend({
      cli: z.string().min(1),
      gateway: z.string().min(1),
    }),
  }),
});

async function tool(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) {
    if (!Buffer.isBuffer(bytes)) throw Error("Invalid file stream");
    hash.update(bytes);
  }
  return { file, sha256: hash.digest("hex") };
}

/** Build release metadata from explicit, already-built component inputs. */
export async function createDevelopmentRelease(options: {
  inputFile: string;
  outputFile: string;
}) {
  const input = inputSchema.parse(
    JSON.parse(await readFile(options.inputFile, "utf8")),
  );
  const directory = dirname(resolve(options.inputFile));
  const release = releaseSchema.parse({
    ...input,
    tools: {
      openshell: {
        ...input.tools.openshell,
        cli: await tool(resolve(directory, input.tools.openshell.cli)),
        gateway: await tool(resolve(directory, input.tools.openshell.gateway)),
      },
    },
  });
  await writeFile(options.outputFile, JSON.stringify(release, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return release;
}
