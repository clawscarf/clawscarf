import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { releaseSchema, hostPlatformSchema } from "./definition.js";
import { packageOperator } from "./operator.js";
import { liteLlmImage, postgresImage } from "../deployment/images.js";

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const pinsSchema = z.object({
  openshell: z.object({
    version: z.string(),
    sourceRevision: z.string(),
    cli: z.record(z.string(), z.object({ url: z.url(), sha256: z.string() })),
    gateway: z.record(
      z.string(),
      z.object({ url: z.url(), sha256: z.string() }),
    ),
  }),
});

await new Command("build-release-candidate")
  .requiredOption("--version <version>", "Exact candidate version")
  .requiredOption("--images <file>", "Built and pushed image digests")
  .requiredOption("--output <directory>", "New candidate directory")
  .action(
    async (options: { version: string; images: string; output: string }) => {
      const version = releaseSchema.shape.version.parse(options.version);
      const root = process.cwd();
      const output = resolve(options.output);
      const images = z
        .record(z.string(), z.string())
        .parse(JSON.parse(await readFile(options.images, "utf8")));
      const pins = pinsSchema.parse(
        JSON.parse(
          await readFile(join(root, "release/components.json"), "utf8"),
        ),
      );
      const revision = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      await mkdir(output);
      const tools = join(output, "tools");
      await mkdir(tools);
      const downloads: Record<
        string,
        Record<string, { file: string; sha256: string; url: string }>
      > = { cli: {}, gateway: {} };
      const platforms = hostPlatformSchema.options;
      for (const platform of platforms) {
        const platformTools = join(tools, platform);
        await mkdir(platformTools);
        for (const name of ["cli", "gateway"] as const) {
          const pin = pins.openshell[name][platform];
          if (!pin) throw Error(`Missing ${platform} OpenShell ${name} pin.`);
          const response = await fetch(pin.url, {
            signal: AbortSignal.timeout(300_000),
          });
          if (!response.ok)
            throw Error(`Cannot download OpenShell ${name} for ${platform}.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (sha256(bytes) !== pin.sha256)
            throw Error(`OpenShell ${name} archive checksum mismatch.`);
          const archive = join(platformTools, `${name}.tgz`);
          await writeFile(archive, bytes);
          const binary = name === "cli" ? "openshell" : "openshell-gateway";
          execFileSync("tar", ["-xzf", archive, "-C", platformTools, binary]);
          await rm(archive);
          const asset = `${binary}-${platform}`;
          await cp(join(platformTools, binary), join(output, asset));
          (downloads[name] ??= {})[platform] = {
            file: `tools/${platform}/${binary}`,
            sha256: sha256(await readFile(join(platformTools, binary))),
            url: `https://github.com/clawscarf/clawscarf/releases/download/v${version}/${asset}`,
          };
        }
      }
      const runtime = releaseSchema.parse({
        schemaVersion: 1,
        version,
        sourceRevision: revision,
        platforms,
        images: {
          postgres: postgresImage,
          models: liteLlmImage,
          gateway: images.runtime,
          companion: images.companion,
          openshellClient: images["openshell-client"],
          relay: images["browser-relay"],
          browser: {
            chromium: images.browser,
            node: images["browser-node"],
            dns: images["browser-dns"],
            egress: images["browser-egress"],
          },
        },
        tools: { openshell: { version: pins.openshell.version, ...downloads } },
      });
      const runtimeFile = join(output, "clawscarf-release.json");
      await writeFile(runtimeFile, JSON.stringify(runtime, null, 2) + "\n");
      for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
        await cp(join(root, file), join(output, file));
      await cp(join(root, "release/licenses"), join(output, "licenses"), {
        recursive: true,
      });
      const license = await fetch(
        `https://raw.githubusercontent.com/NVIDIA/OpenShell/${pins.openshell.sourceRevision}/LICENSE`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!license.ok) throw Error("OpenShell license unavailable.");
      await writeFile(
        join(output, "licenses/openshell-LICENSE"),
        await license.text(),
      );
      await cp(
        join(root, "scripts/packs/requirements.txt"),
        join(output, "pack-requirements.txt"),
      );
      for (const platform of platforms)
        execFileSync("tar", [
          "-czf",
          join(output, `clawscarf-runtime-${version}-${platform}.tgz`),
          "-C",
          output,
          `tools/${platform}`,
          "clawscarf-release.json",
          "LICENSE",
          "THIRD_PARTY_NOTICES.md",
          "licenses",
          "pack-requirements.txt",
        ]);
      const operator = await packageOperator(
        root,
        join(output, "operator"),
        runtimeFile,
      );
      await cp(operator, join(output, `clawscarf-cli-${version}.tgz`));
      await rm(join(output, "operator"), { recursive: true });
      await rm(tools, { recursive: true });
      await rm(join(output, "licenses"), { recursive: true });
      await writeFile(
        join(output, "install.sh"),
        (await readFile(join(root, "release/install.sh"), "utf8")).replace(
          "@VERSION@",
          version,
        ),
      );
      const sums = [];
      for (const entry of (await readdir(output)).sort())
        sums.push(`${sha256(await readFile(join(output, entry)))}  ${entry}`);
      await writeFile(join(output, "SHA256SUMS"), sums.join("\n") + "\n");
      process.stdout.write(`Release candidate: ${output}\n`);
    },
  )
  .parseAsync();
