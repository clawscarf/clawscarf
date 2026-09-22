import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { loadConnectionsCredential } from "../../runtime/connections-credential.js";
import { runtimeTrust } from "../../runtime/trust.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

await test("unconfigured startup leaves optional private state absent and inherited trust unchanged", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "clawscarf-credential-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  assert.equal(await loadConnectionsCredential(state), undefined);
  assert.equal(await runtimeTrust(state, undefined), undefined);
  assert.equal(
    await runtimeTrust(state, "/operator/trusted.pem"),
    "/operator/trusted.pem",
  );
  assert.deepEqual(await readdir(state), []);
});

await test("private credential and optional certificate are validated without rewriting retained bytes", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "clawscarf-credential-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const directory = join(state, "clawscarf-connections");
  await mkdir(directory, { mode: 0o700 });
  const path = join(directory, "runtime.json");
  const value = JSON.stringify({ token: "fixture-scoped-token" });
  await writeFile(path, value, { mode: 0o600 });
  assert.deepEqual(await loadConnectionsCredential(state), {
    token: "fixture-scoped-token",
  });
  const certificate = rootCertificates[0];
  assert.ok(certificate);
  const caPath = join(directory, "ca.pem");
  await writeFile(caPath, certificate, { mode: 0o600 });
  const loaded = await loadConnectionsCredential(state);
  assert.equal(loaded?.ca?.toString(), certificate);
  assert.equal(await runtimeTrust(state, undefined), caPath);
  assert.equal(await readFile(path, "utf8"), value);
  assert.deepEqual((await readdir(directory)).sort(), [
    "ca.pem",
    "runtime.json",
  ]);
});

await test("partial, malformed, exposed, linked and oversized credential material fails closed", async (t) => {
  for (const scenario of [
    "missing",
    "empty",
    "whitespace",
    "control",
    "extra",
    "malformed",
    "large",
    "mode",
    "directory-mode",
    "symlink",
    "hardlink",
    "directory-symlink",
    "invalid-ca",
    "ca-symlink",
    "ca-mode",
  ] as const) {
    await t.test(scenario, async () => {
      const state = await mkdtemp(join(tmpdir(), "clawscarf-credential-"));
      const directory = join(state, "clawscarf-connections");
      const path = join(directory, "runtime.json");
      try {
        await mkdir(directory, { mode: 0o700 });
        await writeFile(path, JSON.stringify({ token: "fixture" }), {
          mode: 0o600,
        });
        if (scenario === "missing") await rm(path);
        if (scenario === "empty") await writeFile(path, '{"token":""}');
        if (scenario === "whitespace") await writeFile(path, '{"token":"a b"}');
        if (scenario === "control")
          await writeFile(path, JSON.stringify({ token: "a\u0000b" }));
        if (scenario === "extra")
          await writeFile(path, '{"token":"fixture","apiKey":"forbidden"}');
        if (scenario === "malformed") await writeFile(path, "not JSON");
        if (scenario === "large")
          await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
        if (scenario === "mode") await chmod(path, 0o644);
        if (scenario === "directory-mode") await chmod(directory, 0o755);
        if (scenario === "symlink") {
          await rm(path);
          await symlink(join(state, "missing"), path);
        }
        if (scenario === "hardlink") await link(path, join(state, "alias"));
        if (scenario === "directory-symlink") {
          await rm(directory, { recursive: true });
          await symlink(state, directory);
        }
        if (scenario === "invalid-ca")
          await writeFile(join(directory, "ca.pem"), "not a certificate", {
            mode: 0o600,
          });
        if (scenario === "ca-symlink")
          await symlink(join(state, "missing"), join(directory, "ca.pem"));
        if (scenario === "ca-mode") {
          await writeFile(
            join(directory, "ca.pem"),
            rootCertificates[0] ?? "",
            { mode: 0o600 },
          );
          await chmod(join(directory, "ca.pem"), 0o644);
        }
        await assert.rejects(loadConnectionsCredential(state));
      } finally {
        await rm(state, { recursive: true, force: true });
      }
    });
  }
});

await test("launcher privately loads the token before exec without evaluating its contents, and blocks invalid material", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "clawscarf-launcher-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const directory = join(state, "clawscarf-connections");
  await mkdir(directory, { mode: 0o700 });
  const marker = join(state, "must-not-exist");
  const token = `$(touch\${IFS}${marker})`;
  await writeFile(join(directory, "runtime.json"), JSON.stringify({ token }), {
    mode: 0o600,
  });
  const upstream = join(state, "upstream.mjs");
  await writeFile(
    upstream,
    "process.stdout.write(JSON.stringify({token:process.env.CLAWSCARF_CONNECTIONS_TOKEN,args:process.argv.slice(2)}));",
  );
  // Relocate only installed executable paths; execute the production shell logic unchanged.
  const launcher = join(state, "openclaw.sh");
  await writeFile(
    launcher,
    (await readFile(join(root, "runtime/openclaw.sh"), "utf8"))
      .replaceAll(
        "/usr/local/bin/node",
        `${process.execPath} --import ${join(root, "node_modules/tsx/dist/loader.mjs")}`,
      )
      .replaceAll(
        "/app/clawscarf/connections-credential-main.js",
        join(root, "runtime/connections-credential-main.ts"),
      )
      .replaceAll(
        "/app/clawscarf/gateway-password-main.js",
        join(root, "runtime/gateway-password-main.ts"),
      )
      .replaceAll(
        "/app/clawscarf/trust-main.js",
        join(root, "runtime/trust-main.ts"),
      )
      .replaceAll("/app/openclaw.mjs", upstream),
  );
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: state,
    NODE_EXTRA_CA_CERTS: "",
    CLAWSCARF_CONNECTIONS_TOKEN: "stale-environment",
  };
  const result = await execute("sh", [launcher, "gateway"], { env, cwd: root });
  assert.deepEqual(JSON.parse(result.stdout), { token, args: ["gateway"] });
  assert.equal(result.stderr, "");
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  for (const invalid of [
    JSON.stringify({ token: "invalid secret with spaces" }),
    '{"token":"private-parse-error-material",',
  ]) {
    await writeFile(join(directory, "runtime.json"), invalid);
    await assert.rejects(
      execute("sh", [launcher, "gateway"], { env, cwd: root }),
      (error: unknown) => {
        assert.ok(
          error instanceof Error && "stdout" in error && "stderr" in error,
        );
        assert.equal(error.stdout, "");
        assert.equal(
          error.stderr,
          "Cannot load the Connections runtime credential. Check its private credential and certificate files.\n",
        );
        return true;
      },
    );
  }
  await rm(directory, { recursive: true });
  const absent = await execute("sh", [launcher, "gateway"], { env, cwd: root });
  assert.deepEqual(JSON.parse(absent.stdout), {
    token: "stale-environment",
    args: ["gateway"],
  });
  assert.equal(absent.stderr, "");
});
