import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseLocalInput } from "../local/configuration.js";
import { postgresImage } from "../local/compose.js";
import { releaseSchema } from "./definition.js";

async function tool(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) {
    if (!Buffer.isBuffer(bytes)) throw Error("Invalid file stream");
    hash.update(bytes);
  }
  return { file: resolve(file), sha256: hash.digest("hex") };
}
/** Build a development release from explicit, already-built component inputs. */
export async function createDevelopmentRelease(options: {
  inputFile: string;
  outputFile: string;
  version: string;
  sourceRevision: string;
  openshellVersion: string;
}) {
  const input = parseLocalInput(
    JSON.parse(await readFile(options.inputFile, "utf8")),
  );
  if (!input.execution || !input.relayImage)
    throw Error("A release requires the protected worker and relay.");
  const release = releaseSchema.parse({
    schemaVersion: 1,
    version: options.version,
    sourceRevision: options.sourceRevision,
    platforms: ["darwin-arm64"],
    images: {
      postgres: postgresImage,
      gateway: input.runtimeImage,
      worker: input.execution.image,
      companion: input.companionImage,
      relay: input.relayImage,
      ...(input.browser
        ? {
            browser: {
              chromium: input.browser.image,
              node: input.browser.nodeImage,
              dns: input.browser.dnsImage,
              egress: input.browser.egressImage,
            },
          }
        : {}),
    },
    tools: {
      openshell: {
        version: options.openshellVersion,
        cli: await tool(input.openshellCli),
        gateway: await tool(input.openshellGateway),
      },
    },
  });
  await writeFile(options.outputFile, JSON.stringify(release, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return release;
}
