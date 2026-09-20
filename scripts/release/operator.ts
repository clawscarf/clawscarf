import { releaseSchema } from "./definition.js";
import { recipeSchema } from "../installation/recipes/definition.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { writeRuntimePackage } from "./runtime-package.js";

const execute = promisify(execFile);
const assets = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "generated/http/LICENSE.md",
  "scripts/deployment/upgrade-rpc.py",
  "scripts/packs/transport.py",
  "scripts/packs/requirements.in",
  "scripts/packs/requirements.txt",
  "services/access/migrations",
  "services/connections/migrations",
  "release/components.json",
  "release/README.md",
  "recipes",
  "packs",
  "runtime/releases",
  "deploy/models/catalog.json",
  "deploy/openshell/policy.yaml",
  "deploy/execution/browser/seccomp.json",
  "deploy/execution/network/node-ingress.cfg",
  "deploy/execution/browser/LICENSE.playwright",
];

export async function stageOperatorAssets(root: string) {
  for (const path of assets) {
    const target = join(root, "dist", path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await cp(join(root, path), target, { recursive: true });
  }
}

// Explicit operator payload: no companion server, source tooling or installation state.
const payload = [
  ...assets.filter((path) => !path.startsWith("scripts/")),
  "generated/http/client",
  "generated/http/core",
  "scripts/clawscarf.js",
  "scripts/output.js",
  "scripts/errors.js",
  "scripts/session.js",
  "scripts/people.js",
  "scripts/connections.js",
  "scripts/cloud",
  "services/cloud/generated",
  "services/connections/cloud/generated",
  "scripts/installation",
  "scripts/release/create.js",
  "scripts/release/definition.js",
  "scripts/controller.js",
  "scripts/deployment",
  "scripts/models",
  "scripts/packs",
  "runtime/configuration.js",
  "runtime/model-contract.js",
  "runtime/connections-configuration.js",
  "services/access/repo",
  "services/access/types",
  "services/access/generated",
  "deploy/execution/browser-node/configuration.js",
  "deploy/execution/browser-node/operator.js",
];

/** Package an already built operator; dependency installation and publication are separate. */
export async function packageOperator(
  root: string,
  destination: string,
  publishedRuntime?: string,
) {
  const output = resolve(destination);
  await mkdir(output); // Refuse overwriting an earlier artifact directory.
  const temporary = await mkdtemp(join(tmpdir(), "clawscarf-operator-"));
  const stage = join(temporary, "package");
  await mkdir(stage);
  try {
    for (const path of payload) {
      const target = join(stage, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await cp(join(root, "dist", path), target, { recursive: true });
    }
    const runtime = publishedRuntime
      ? releaseSchema.parse(
          JSON.parse(await readFile(publishedRuntime, "utf8")),
        )
      : undefined;
    if (runtime) {
      if (
        JSON.stringify(runtime.images).includes('"sha256:') ||
        !runtime.tools.openshell.cli.url ||
        !runtime.tools.openshell.gateway.url
      )
        throw Error(
          "Published runtimes require registry digests and downloadable tools.",
        );
      await rm(join(stage, "runtime/releases"), { recursive: true });
      await mkdir(join(stage, "runtime/releases"));
      await writeFile(
        join(stage, "runtime/releases", `${runtime.version}.json`),
        JSON.stringify(runtime, null, 2) + "\n",
      );
      for (const entry of await readdir(join(stage, "recipes"), {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const file = join(stage, "recipes", entry.name, "recipe.json");
        const recipe = recipeSchema.parse(
          JSON.parse(await readFile(file, "utf8")),
        );
        if (recipe.runtime !== "../../runtime/releases/0.1.0-dev.json")
          throw Error(
            `Recipe ${recipe.id} does not select the development runtime being released.`,
          );
        recipe.runtime = `../../runtime/releases/${runtime.version}.json`;
        await writeFile(file, JSON.stringify(recipe, null, 2) + "\n");
      }
    }
    // Remote helpers are shipped as data, executed against their runtime SDK.
    const manifest = await writeRuntimePackage(
      root,
      stage,
      ["scripts/clawscarf.js", "scripts/people.js", "scripts/controller.js"],
      {
        name: "@clawscarf/cli",
        ...(runtime ? { version: runtime.version, private: false } : {}),
        bin: { clawscarf: "scripts/clawscarf.js" },
        scripts: {
          clawscarf: "node scripts/clawscarf.js",
          controller: "node scripts/controller.js",
        },
      },
    );
    if (runtime) {
      await writeFile(
        join(stage, "package.json"),
        JSON.stringify(
          {
            ...manifest,
            repository: {
              type: "git",
              url: "git+https://github.com/clawscarf/clawscarf.git",
            },
            publishConfig: { access: "public" },
          },
          null,
          2,
        ) + "\n",
      );
    }
    await chmod(join(stage, "scripts/clawscarf.js"), 0o755);
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
