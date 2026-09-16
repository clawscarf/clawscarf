import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { packageOperator } from "./release/operator.js";

const execute = promisify(execFile);
await test(
  "compiled operator archive runs outside the checkout with frozen production dependencies",
  {
    skip: process.env.CLAWSCARF_TEST_OPERATOR_ARCHIVE !== "1",
    timeout: 240000,
  },
  async (t) => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-archive-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, "artifacts");
    const archive = await packageOperator(root, output);
    const digest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    assert.equal(
      (await readFile(join(output, "SHA256SUMS"), "utf8")).split(" ")[0],
      digest,
    );
    await assert.rejects(packageOperator(root, output), { code: "EEXIST" });
    const { stdout: listing } = await execute("tar", ["-tzf", archive]);
    assert.ok(listing.includes("package/services/access/migrations/"));
    assert.ok(listing.includes("package/generated/http/client/index.js"));
    assert.ok(listing.includes("package/generated/http/LICENSE.md"));
    for (const obsolete of [
      "scripts/local.js",
      "scripts/models.js",
      "scripts/runtime-config.js",
      "services/access/generated/server/",
      "services/connections/generated/server/",
      "services/access/generated/client/",
      "services/connections/generated/client/",
    ])
      assert.ok(!listing.includes(`package/${obsolete}`));
    assert.ok(listing.includes("package/services/connections/migrations/"));
    assert.ok(listing.includes("package/scripts/packs/transport.py"));
    assert.ok(listing.includes("package/release/components.json"));
    assert.ok(listing.includes("package/runtime/model-contract.js"));
    assert.ok(listing.includes("package/pnpm-lock.yaml"));
    assert.ok(
      listing.includes(
        "package/deploy/execution/browser-node/configuration.js",
      ),
    );
    assert.ok(
      listing.includes("package/deploy/execution/browser-node/operator.js"),
    );
    assert.ok(
      !listing.includes("node_modules") && !listing.includes(".local/"),
    );
    assert.ok(!listing.includes(".env") && !listing.includes("check-docs"));
    assert.ok(
      !listing.includes("apps/companion") && !listing.includes(".test."),
    );
    assert.ok(!listing.includes("services/connections/runtime/"));
    await execute("tar", ["-xzf", archive, "-C", directory]);
    const cwd = join(directory, "package");
    const manifest: unknown = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8"),
    );
    assert.ok(
      manifest && typeof manifest === "object" && "dependencies" in manifest,
    );
    assert.ok(!("devDependencies" in manifest));
    assert.ok(!JSON.stringify(manifest).includes('"react"'));
    assert.ok(!JSON.stringify(manifest).includes('"typescript"'));
    for (const path of [
      "deploy/execution/worker/policy.yaml",
      "deploy/execution/browser/seccomp.json",
      "deploy/execution/network/node-ingress.cfg",
      "deploy/execution/browser/LICENSE.playwright",
    ]) {
      assert.deepEqual(
        await readFile(join(cwd, path)),
        await readFile(join(root, path)),
        `The archive must retain its execution input: ${path}`,
      );
    }
    await execute(
      "pnpm",
      ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
      {
        cwd,
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    for (const command of ["clawscarf", "controller"]) {
      const { stdout } = await execute(
        process.execPath,
        [`scripts/${command}.js`, "--help"],
        { cwd, timeout: 15000 },
      );
      assert.match(stdout, /Usage:/);
    }
    for (const args of [
      ["scripts/clawscarf.js", "install", "--help"],
      ["scripts/clawscarf.js", "packs", "--help"],
      ["scripts/clawscarf.js", "config", "render-native", "--help"],
      ["scripts/clawscarf.js", "connections", "configure", "--help"],
      ["services/connections/credential-command.js", "--help"],
    ]) {
      const { stdout } = await execute(process.execPath, args, {
        cwd,
        timeout: 15000,
      });
      assert.match(stdout, /Usage:/);
    }
    await assert.rejects(
      execute(process.execPath, ["scripts/clawscarf.js", "install"], {
        cwd,
        timeout: 15000,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.includes("interactive terminal"),
    );
    const configuration = join(directory, "models.json");
    const rendered = join(directory, "gateway.json");
    await copyFile(
      join(root, "deploy/models/config.example.json"),
      configuration,
    );
    await execute(
      process.execPath,
      [
        "scripts/clawscarf.js",
        "models",
        "render",
        "--config",
        configuration,
        "--output",
        rendered,
      ],
      { cwd },
    );
    assert.match(
      await readFile(rendered, "utf8"),
      /openrouter\/openai\/gpt-5\.4/,
    );
    const { stdout } = await execute(
      "pnpm",
      ["list", "--depth", "0", "--json"],
      { cwd },
    );
    assert.ok(!stdout.includes('"typescript"') && !stdout.includes('"tsx"'));
  },
);
