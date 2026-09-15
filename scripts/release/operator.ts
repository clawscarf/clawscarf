import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
// Explicit operator payload: no companion server, source tooling or installation state.
const payload = [
  "scripts/local.js",
  "scripts/controller.js",
  "scripts/models.js",
  "scripts/packs.js",
  "scripts/local",
  "scripts/models",
  "scripts/packs",
  "runtime/configuration.js",
  "services/access/repo",
  "services/access/types",
  "services/access/generated/client",
  "services/connections/generated/client",
  "services/access/migrations",
  "services/connections/migrations",
  "release/components.json",
  "deploy/openshell/policy.yaml",
];

/** Package an already built operator; dependency installation and publication are separate. */
export async function packageOperator(root: string, destination: string) {
  const output = resolve(destination);
  await mkdir(output); // Refuse overwriting an earlier artifact directory.
  const temporary = await mkdtemp(join(tmpdir(), "clawscarf-operator-"));
  const stage = join(temporary, "package");
  await mkdir(stage);
  try {
    const manifest = z
      .object({
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
        engines: z.record(z.string(), z.string()),
        packageManager: z.string(),
        dependencies: z.record(z.string(), z.string()),
        devDependencies: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify(
        {
          ...manifest,
          name: "clawscarf-operator",
          private: true,
          type: "module",
          license: "MIT",
          scripts: {
            local: "node scripts/local.js",
            controller: "node scripts/controller.js",
            models: "node scripts/models.js",
            packs: "node scripts/packs.js",
          },
        },
        null,
        2,
      ) + "\n",
    );
    for (const path of payload) {
      const target = join(stage, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await cp(join(root, "dist", path), target, { recursive: true });
    }
    for (const path of ["pnpm-lock.yaml", "LICENSE", "THIRD_PARTY_NOTICES.md"])
      await cp(join(root, path), join(stage, path));
    await cp(
      join(root, "release/operator.md"),
      join(stage, "release/operator.md"),
    );
    await writeFile(
      join(stage, "README.md"),
      "# ClawScarf operator\n\nRead the [operator instructions](release/operator.md).\n",
    );
    const filename = `clawscarf-operator-${manifest.version}.tgz`;
    // A distribution archive retains its lockfile; npm packages intentionally omit it.
    await execute(
      "tar",
      ["-czf", join(output, filename), "-C", temporary, "package"],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
    const bytes = await readFile(join(output, filename));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(output, "SHA256SUMS"), `${checksum}  ${filename}\n`, {
      flag: "wx",
    });
    return join(output, filename);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
