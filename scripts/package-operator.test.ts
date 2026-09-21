import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { z } from "zod";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { releaseTools } from "./release/definition.js";
import { packageOperator } from "./release/operator.js";
import { postgresImage } from "./deployment/images.js";

// Test CLI invocations never report to the packaged production destination.
process.env.CLAWSCARF_TELEMETRY_DISABLED = "1";

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
    assert.ok(listing.includes("package/release/telemetry.json"));
    assert.ok(listing.includes("package/scripts/telemetry.js"));
    assert.ok(listing.includes("package/recipes/team-server/recipe.json"));
    assert.ok(listing.includes("package/packs/research-team/pack.json"));
    assert.ok(listing.includes("package/runtime/current.json"));
    assert.ok(!listing.includes("package/runtime/tools/"));
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
    assert.ok("bin" in manifest);
    assert.deepEqual(manifest.bin, { clawscarf: "scripts/clawscarf.js" });
    assert.match(
      await readFile(join(cwd, "scripts/clawscarf.js"), "utf8"),
      /^#!\/usr\/bin\/env node\n/,
    );
    assert.ok(!JSON.stringify(manifest).includes('"react"'));
    assert.ok(!JSON.stringify(manifest).includes('"typescript"'));
    for (const path of [
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
    const { stdout: executableHelp } = await execute(
      "./scripts/clawscarf.js",
      ["--help"],
      { cwd },
    );
    assert.match(executableHelp, /Usage:/);
    const buildInput = join(directory, "components.json");
    const fixtureTool = join(directory, "tool");
    await writeFile(fixtureTool, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(
      buildInput,
      JSON.stringify({
        schemaVersion: 1,
        version: "0.1.0-dev",
        sourceRevision: "a".repeat(40),
        platforms: ["darwin-arm64"],
        images: {
          postgres: postgresImage,
          ...Object.fromEntries(
            ["gateway", "companion", "openshellClient"].map((name) => [
              name,
              "sha256:" + "a".repeat(64),
            ]),
          ),
        },
        tools: {
          openshell: {
            version: "0.0.116",
            cli: fixtureTool,
            gateway: fixtureTool,
          },
        },
      }),
    );
    const bundle = join(directory, "release");
    await execute(
      "./scripts/clawscarf.js",
      ["release-create", "--input", buildInput, "--output", bundle],
      { cwd },
    );
    assert.match(
      await readFile(join(bundle, "clawscarf-release.json"), "utf8"),
      /tools\/openshell/,
    );
    for (const args of [
      ["scripts/clawscarf.js", "configure", "--help"],
      ["scripts/clawscarf.js", "people", "--help"],
      ["scripts/clawscarf.js", "status", "--help"],
      ["scripts/clawscarf.js", "connections", "--help"],
    ]) {
      const { stdout } = await execute(process.execPath, args, {
        cwd,
        timeout: 15000,
      });
      assert.match(stdout, /Usage:/);
    }
    await assert.rejects(
      execute(process.execPath, ["scripts/clawscarf.js", "configure"], {
        cwd,
        timeout: 15000,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.includes("--non-interactive"),
    );
    const listed = await execute(
      process.execPath,
      ["scripts/clawscarf.js", "recipes", "--json"],
      { cwd },
    );
    assert.match(listed.stdout, /gpt-6-astra/);
    const { stdout } = await execute(
      "pnpm",
      ["list", "--depth", "0", "--json"],
      { cwd },
    );
    assert.ok(!stdout.includes('"typescript"') && !stdout.includes('"tsx"'));
    await verifyPackagedTelemetry(cwd, t);
  },
);

await test(
  "publishable npm package resolves its recipe to the candidate runtime without checkout paths",
  {
    skip: process.env.CLAWSCARF_TEST_OPERATOR_ARCHIVE !== "1",
    timeout: 120000,
  },
  async (t) => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-npm-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { releaseSchema } = await import("./release/definition.js");
    const runtime = releaseSchema.parse(
      JSON.parse(await readFile(join(root, "runtime/current.json"), "utf8")),
    );
    runtime.version = "0.1.0-test.1";
    // Fixture registry references test packaging, not image availability or deployment.
    runtime.images.gateway =
      runtime.images.companion =
      runtime.images.openshellClient =
        `ghcr.io/clawscarf/fixture@sha256:${"a".repeat(64)}`;
    delete runtime.images.browser;
    delete runtime.images.relay;
    for (const name of ["cli", "gateway"] as const)
      releaseTools(runtime, "darwin-arm64")[name].url =
        `https://example.test/${name}`;
    const file = join(directory, "runtime.json");
    await writeFile(file, JSON.stringify(runtime));
    const archive = await packageOperator(
      root,
      join(directory, "output"),
      file,
    );
    const prefix = join(directory, "npm");
    await execute(
      "npm",
      ["install", "--global", "--prefix", prefix, "--ignore-scripts", archive],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
    );
    const installed = join(prefix, "lib/node_modules/@clawscarf/cli");
    const manifest: unknown = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    );
    assert.ok(
      manifest &&
        typeof manifest === "object" &&
        "private" in manifest &&
        manifest.private === false,
    );
    const { stdout } = await execute(
      join(prefix, "bin/clawscarf"),
      ["recipes", "--json"],
      { cwd: tmpdir() },
    );
    assert.match(stdout, /team-server/);
    assert.match(stdout, /runtime\/current\.json/);
    assert.ok(!stdout.includes(root));
    assert.equal(
      await readFile(join(installed, "runtime/current.json"), "utf8"),
      JSON.stringify(runtime, null, 2) + "\n",
    );
  },
);

async function verifyPackagedTelemetry(
  cwd: string,
  t: import("node:test").TestContext,
) {
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  let status = 200;
  const receiver = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = z
        .object({
          batch: z.array(
            z.object({
              event: z.string(),
              properties: z.record(z.string(), z.unknown()),
            }),
          ),
        })
        .parse(JSON.parse(body));
      events.push(...payload.batch);
      response.writeHead(status);
      response.end(status === 200 ? '{"status":1}' : "private upstream error");
    });
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  t.after(() => {
    receiver.closeAllConnections();
    receiver.close();
  });
  const address = receiver.address();
  assert.ok(address && typeof address !== "string");
  await writeFile(
    join(cwd, "release/telemetry.json"),
    JSON.stringify({
      host: `http://127.0.0.1:${String(address.port)}`,
      projectToken: "phc_test",
    }),
  );
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(cwd, "test-config"),
    CLAWSCARF_TELEMETRY_DISABLED: "",
  };
  const invoke = (...args: string[]) =>
    execute(process.execPath, ["scripts/clawscarf.js", ...args], {
      cwd,
      env,
      timeout: 10000,
    });
  const first = await invoke("recipes", "--json");
  assert.match(first.stderr, /CLAWSCARF_TELEMETRY_DISABLED=1/);
  assert.ok(JSON.parse(first.stdout));
  assert.equal(events.length, 2);
  assert.equal(events[1]?.properties.outcome, "success");
  await assert.rejects(
    invoke("status", "--directory", "/nonexistent/private-team", "--json"),
    (error: unknown) => {
      assert.ok(
        error instanceof Error &&
          "stderr" in error &&
          typeof error.stderr === "string",
      );
      assert.ok(JSON.parse(error.stderr));
      return true;
    },
  );
  assert.equal(events.length, 4);
  assert.equal(events[3]?.properties.outcome, "failure");
  assert.equal(events[3].properties.error_code, "unavailable");
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-team|private upstream error/,
  );
  status = 503;
  const unavailable = await invoke("recipes", "--json");
  assert.equal(unavailable.stdout, first.stdout);
  assert.equal(unavailable.stderr, "");
  assert.equal(events.length, 6);
  const help = await invoke("--help");
  assert.equal(help.stderr, "");
  assert.equal(events.length, 6);
  await assert.rejects(invoke("secret-invalid-command"));
  assert.equal(events.length, 6);
  const disabled = await execute(
    process.execPath,
    ["scripts/clawscarf.js", "recipes", "--json"],
    {
      cwd,
      env: {
        ...env,
        CLAWSCARF_TELEMETRY_DISABLED: "1",
        XDG_CONFIG_HOME: join(cwd, "disabled-config"),
      },
    },
  );
  assert.equal(disabled.stdout, first.stdout);
  assert.equal(disabled.stderr, "");
  assert.equal(events.length, 6);
  await assert.rejects(
    readFile(join(cwd, "disabled-config/clawscarf/telemetry-id")),
    { code: "ENOENT" },
  );
  status = 200;
  const installation = join(cwd, "private-installation");
  for (const mode of ["new", "edit"] as const) {
    if (mode === "edit") {
      await mkdir(join(installation, "state"), { recursive: true });
      await writeFile(
        join(installation, "installation.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "private-team",
          releaseFile: "release.json",
          stateDirectory: "state",
          exposure: {
            mode: "local",
            applicationPort: 18800,
            widgetPort: 18802,
          },
          access: { mode: "hosted", administratorName: "Private Owner" },
          resources: { runtime: { cpu: "2", memory: "2Gi" } },
          browser: { enabled: false },
          models: {
            mode: "litellm",
            configurationFile: "models.json",
            upstreamEnvironmentFile: "secret.env",
          },
          connections: { mode: "disabled" },
          packs: [],
        }),
      );
      await writeFile(join(installation, "state/settings.json"), "{}");
      await writeFile(join(installation, "state/prepared.json"), "{}");
    }
    // Missing Docker for new setup, and missing --yes for edits: neither can mutate a runtime.
    await assert.rejects(
      execute(
        process.execPath,
        [
          "scripts/clawscarf.js",
          "configure",
          "--directory",
          installation,
          "--non-interactive",
          "--json",
        ],
        {
          cwd,
          env: { ...env, PATH: join(cwd, "empty-path") },
          timeout: 10000,
        },
      ),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        if (mode === "edit") assert.match(error.stderr, /requires --yes/);
        return true;
      },
    );
    assert.equal(events.at(-1)?.properties.configuration_mode, mode);
    assert.equal(events.at(-1)?.properties.outcome, "failure");
  }
  assert.equal(events.length, 10);
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-team|Private Owner|secret.env|private-installation/,
  );
}
