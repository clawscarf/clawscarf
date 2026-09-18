import { OperatorError } from "../errors.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
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

async function tool(source: string, destination: string, file: string) {
  const stat = await lstat(source);
  if (!stat.isFile() || !(stat.mode & 0o111))
    throw new OperatorError("Release tools must be regular executable files.");
  await copyFile(source, destination);
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(destination)) {
    if (!Buffer.isBuffer(bytes)) throw new OperatorError("Invalid file stream");
    hash.update(bytes);
  }
  return { file, sha256: hash.digest("hex") };
}

/** Assemble portable payloads from explicit, already-built inputs. Never mutate sources. */
export async function createDevelopmentRelease(options: {
  inputFile: string;
  outputDirectory: string;
}) {
  const input = inputSchema.parse(
    JSON.parse(await readFile(options.inputFile, "utf8")),
  );
  const directory = dirname(resolve(options.inputFile));
  const output = resolve(options.outputDirectory);
  await mkdir(output); // Refuse to merge with an existing bundle.
  try {
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
      await copyFile(
        fileURLToPath(new URL(`../../${name}`, import.meta.url)),
        join(output, name),
      );
    await mkdir(join(output, "tools"));
    const release = releaseSchema.parse({
      ...input,
      tools: {
        openshell: {
          ...input.tools.openshell,
          cli: await tool(
            resolve(directory, input.tools.openshell.cli),
            join(output, "tools/openshell"),
            "tools/openshell",
          ),
          gateway: await tool(
            resolve(directory, input.tools.openshell.gateway),
            join(output, "tools/openshell-gateway"),
            "tools/openshell-gateway",
          ),
        },
      },
    });
    const releaseFile = join(output, "clawscarf-release.json");
    await writeFile(releaseFile, JSON.stringify(release, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return release;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
