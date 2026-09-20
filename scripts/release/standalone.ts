import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { digest, hostPlatformSchema, releaseSchema } from "./definition.js";

const execute = promisify(execFile);

/** Assemble on the target host so dependency installation never cross-compiles implicitly. */
export async function packageStandalone(
  root: string,
  archive: string,
  output: string,
) {
  const platform = hostPlatformSchema.parse(
    `${process.platform}-${process.arch}`,
  );
  const { cliNode } = z
    .object({
      cliNode: z.object({
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        archives: z.record(hostPlatformSchema, digest),
      }),
    })
    .parse(
      JSON.parse(await readFile(join(root, "release/components.json"), "utf8")),
    );
  const temporary = await mkdtemp(join(tmpdir(), "clawscarf-standalone-"));
  try {
    const directory = join(temporary, "clawscarf");
    await mkdir(directory);
    await execute("tar", ["-xzf", resolve(archive), "-C", directory]);
    const cwd = join(directory, "package");
    const { version } = z
      .object({ version: releaseSchema.shape.version })
      .parse(JSON.parse(await readFile(join(cwd, "package.json"), "utf8")));
    await execute(
      "pnpm",
      ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
      {
        cwd,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const name = `node-v${cliNode.version}-${platform}`;
    const response = await fetch(
      `https://nodejs.org/dist/v${cliNode.version}/${name}.tar.gz`,
      {
        signal: AbortSignal.timeout(300_000),
      },
    );
    if (!response.ok)
      throw Error(`Node download failed: ${String(response.status)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      cliNode.archives[platform]
    )
      throw Error("Node archive checksum mismatch.");
    const nodeArchive = join(temporary, "node.tgz");
    await writeFile(nodeArchive, bytes);
    await mkdir(join(directory, "node"));
    await execute("tar", [
      "-xzf",
      nodeArchive,
      "--strip-components=1",
      "-C",
      join(directory, "node"),
      `${name}/bin/node`,
      `${name}/LICENSE`,
    ]);
    await copyFile(
      join(root, "release/launcher.sh"),
      join(directory, "clawscarf"),
    );
    await chmod(join(directory, "clawscarf"), 0o755);
    await mkdir(output, { recursive: true });
    const result = join(output, `clawscarf-${version}-${platform}.tgz`);
    await execute("tar", ["-czf", result, "-C", temporary, "clawscarf"]);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main)
  await new Command("package-standalone")
    .requiredOption("--archive <file>", "Built npm archive")
    .requiredOption("--output <directory>", "Output directory")
    .action(async (options: { archive: string; output: string }) => {
      process.stdout.write(
        (await packageStandalone(
          process.cwd(),
          options.archive,
          resolve(options.output),
        )) + "\n",
      );
    })
    .parseAsync();
