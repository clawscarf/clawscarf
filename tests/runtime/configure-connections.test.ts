import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
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
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import { z } from "zod";
import { initializeHome } from "../../runtime/initialize.js";
import {
  configureRuntimeConnections,
  ConnectionsConfigurationError,
} from "../../runtime/configure-connections.js";
import {
  connectionsConfigurationInputSchema,
  connectionsConfigurationResultSchema,
} from "../../runtime/connections-configuration.js";
import { loadConnectionsCredential } from "../../runtime/connections-credential.js";

const execute = promisify(execFile);
const packageDirectory = fileURLToPath(
  new URL("../../plugins/connections", import.meta.url),
);
const uid = process.getuid?.() ?? 1000,
  gid = process.getgid?.() ?? 1000;
const input = {
  ownerId: randomUUID(),
  serverId: randomUUID(),
  brokerUrl: "https://broker.example/_clawscarf/connections/",
};
const token = "fixture-scoped-secret";
const nativeInitial = {
  gateway: { mode: "local" },
  browser: { enabled: false },
  plugins: { entries: { "clawscarf-connections": { enabled: false } } },
  tools: { sandbox: { tools: { allow: ["read"], deny: ["exec"] } } },
};
async function fixture() {
  const home = await mkdtemp(
    join(tmpdir(), "clawscarf-configure-connections-"),
  );
  await initializeHome(
    home,
    {
      ownerId: input.ownerId,
      serverId: input.serverId,
      configuration: JSON.stringify(nativeInitial),
    },
    uid,
    gid,
  );
  // Configuration validation needs the real manifest and an entry file, not mutable
  // build output. Compiled tool loading is covered by the plugin's native tests.
  const plugin = join(home, "connection-plugin");
  await mkdir(plugin);
  await cp(
    join(packageDirectory, "openclaw.plugin.json"),
    join(plugin, "openclaw.plugin.json"),
  );
  await cp(join(packageDirectory, "src/index.ts"), join(plugin, "index.ts"));
  const metadata = z
    .object({ openclaw: z.looseObject({}) })
    .loose()
    .parse(
      JSON.parse(
        await readFile(join(packageDirectory, "package.json"), "utf8"),
      ),
    );
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      ...metadata,
      openclaw: { ...metadata.openclaw, extensions: ["./index.ts"] },
    }),
  );
  return home;
}
const nativeCommand: NonNullable<
  Parameters<typeof configureRuntimeConnections>[2]
> = async (request, state) => {
  assert.equal(request.packageDirectory, "/app/clawscarf/connections");
  assert.deepEqual(request.replacePackageDirectories, []);
  assert.equal(JSON.stringify(request).includes(token), false);
  const child = execute(
    process.execPath,
    [
      "--experimental-strip-types",
      join(packageDirectory, "src/configuration-command.ts"),
    ],
    {
      env: {
        ...process.env,
        HOME: join(state, ".."),
        OPENCLAW_STATE_DIR: state,
        OPENCLAW_CONFIG_PATH: join(state, "openclaw.json"),
      },
      timeout: 45_000,
      maxBuffer: 64 * 1024,
    },
  );
  // Run the real helper and pinned SDK against this test's stable plugin metadata.
  child.child.stdin?.end(
    JSON.stringify({
      ...request,
      packageDirectory: join(state, "..", "connection-plugin"),
    }),
  );
  const answer = await child;
  return JSON.parse(answer.stdout) as unknown;
};
async function snapshot(
  directory: string,
  prefix = "",
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      for (const [key, value] of await snapshot(
        join(directory, entry.name),
        name + "/",
      ))
        result.set(key, value);
    else
      result.set(
        name,
        createHash("sha256")
          .update(await readFile(join(directory, entry.name)))
          .digest("hex"),
      );
  }
  return result;
}

async function writableTree(path: string, writable: boolean): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await writableTree(child, writable);
    else await chmod(child, writable ? 0o600 : 0o400);
  }
  await chmod(path, writable ? 0o700 : 0o500);
}

await test("stopped configuration preserves native policy; observation reads configured state without sidecars or writes", async (t) => {
  const home = await fixture();
  t.after(async () => {
    await writableTree(home, true);
    await rm(home, { recursive: true, force: true });
  });
  const before = await snapshot(home);
  await writableTree(home, false);
  const observed = await configureRuntimeConnections(
    home,
    { ...input, kind: "observe", credential: { token } },
    nativeCommand,
  );
  assert.equal(observed.state, "unconfigured");
  assert.equal(observed.credentialMatches, false);
  assert.deepEqual(await snapshot(home), before);
  await writableTree(home, true);
  const ca = rootCertificates[0];
  assert.ok(ca);
  const configured = await configureRuntimeConnections(
    home,
    { ...input, kind: "configure", credential: { token, ca } },
    nativeCommand,
  );
  assert.equal(configured.state, "configured");
  assert.ok("enabled" in configured && configured.enabled === false);
  assert.equal(configured.credentialMatches, true);
  const native = z
    .object({ browser: z.unknown(), tools: z.unknown() })
    .parse(
      JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8")),
    );
  assert.deepEqual(native.browser, nativeInitial.browser);
  assert.deepEqual(native.tools, nativeInitial.tools);
  const retained = await snapshot(home);
  assert.equal(retained.has(".openclaw/state/openclaw.sqlite-shm"), false);
  assert.equal(retained.has(".openclaw/state/openclaw.sqlite-wal"), false);
  assert.ok("configHash" in configured);
  assert.equal(configured.configHash, retained.get(".openclaw/openclaw.json"));
  await writableTree(home, false);
  assert.deepEqual(
    await configureRuntimeConnections(
      home,
      { ...input, kind: "observe", credential: { token, ca } },
      nativeCommand,
    ),
    configured,
  );
  assert.deepEqual(await snapshot(home), retained);
  assert.deepEqual(
    await configureRuntimeConnections(
      home,
      {
        ...input,
        kind: "observe",
        brokerUrl: "https://different-broker.example",
        credential: { token, ca },
      },
      nativeCommand,
    ),
    {
      state: "unconfigured",
      enabled: false,
      expectedPackage: true,
      credentialMatches: true,
    },
  );
  assert.deepEqual(await snapshot(home), retained);
  await writableTree(home, true);
  // A writable fixture also stays unchanged: observation does not depend on denied writes.
  assert.deepEqual(
    await configureRuntimeConnections(
      home,
      { ...input, kind: "observe", credential: { token, ca } },
      nativeCommand,
    ),
    configured,
  );
  assert.deepEqual(await snapshot(home), retained);
  await writableTree(home, false);
  assert.equal(
    (
      await configureRuntimeConnections(
        home,
        { ...input, kind: "observe", credential: { token: "different", ca } },
        nativeCommand,
      )
    ).credentialMatches,
    false,
  );
  assert.deepEqual(await snapshot(home), retained);
  await writableTree(home, true);
  assert.equal(JSON.stringify(configured).includes(token), false);
  assert.equal(JSON.stringify(configured).includes(ca), false);
  connectionsConfigurationResultSchema.parse(configured);
  await configureRuntimeConnections(
    home,
    { ...input, kind: "configure", credential: { token: "rotated" } },
    nativeCommand,
  );
  assert.deepEqual(await loadConnectionsCredential(join(home, ".openclaw")), {
    token: "rotated",
  });
  await assert.rejects(
    readFile(join(home, ".openclaw/clawscarf-connections/ca.pem")),
    { code: "ENOENT" },
  );
});

await test("read-only observation refuses malformed native core configuration without changing the home", async (t) => {
  const home = await fixture();
  t.after(async () => {
    await writableTree(home, true);
    await rm(home, { recursive: true, force: true });
  });
  await writeFile(
    join(home, ".openclaw/openclaw.json"),
    JSON.stringify({ ...nativeInitial, gateway: { mode: "invalid-mode" } }),
  );
  const before = await snapshot(home);
  await writableTree(home, false);
  await assert.rejects(
    configureRuntimeConnections(
      home,
      { ...input, kind: "observe" },
      nativeCommand,
    ),
    (error: unknown) =>
      error instanceof ConnectionsConfigurationError &&
      error.code === "connections_configuration_invalid",
  );
  assert.deepEqual(await snapshot(home), before);
});

await test("ownership and retained unsafe paths reject configuration before credential or native changes", async (t) => {
  for (const scenario of [
    "owner",
    "server",
    "marker-symlink",
    "native-symlink",
    "credential-hardlink",
    "ca-symlink",
    "directory-mode",
    "missing-credential",
    "bad-url",
    "bad-ca",
  ] as const) {
    await t.test(scenario, async () => {
      const home = await fixture();
      const state = join(home, ".openclaw");
      const directory = join(state, "clawscarf-connections");
      let nativeCalls = 0;
      const command = () => {
        nativeCalls++;
        return Promise.resolve({ state: "configured" });
      };
      try {
        await mkdir(directory, { mode: 0o700 });
        await writeFile(join(directory, "runtime.json"), '{"token":"old"}', {
          mode: 0o600,
        });
        let value: unknown = {
          ...input,
          kind: "configure",
          credential: { token },
        };
        if (scenario === "owner")
          value = {
            ...input,
            ownerId: randomUUID(),
            kind: "configure",
            credential: { token },
          };
        if (scenario === "server")
          value = {
            ...input,
            serverId: randomUUID(),
            kind: "configure",
            credential: { token },
          };
        if (scenario === "marker-symlink" || scenario === "native-symlink") {
          const path = join(
            state,
            scenario === "marker-symlink"
              ? "clawscarf-installation.json"
              : "openclaw.json",
          );
          await rm(path);
          await symlink(join(home, "missing"), path);
        }
        if (scenario === "credential-hardlink")
          await link(join(directory, "runtime.json"), join(home, "alias"));
        if (scenario === "ca-symlink")
          await symlink(join(home, "missing"), join(directory, "ca.pem"));
        if (scenario === "directory-mode") await chmod(directory, 0o755);
        if (scenario === "missing-credential")
          value = { ...input, kind: "configure" };
        if (scenario === "bad-url")
          value = {
            ...input,
            kind: "configure",
            brokerUrl: "http://broker.example",
            credential: { token },
          };
        if (scenario === "bad-ca")
          value = {
            ...input,
            kind: "configure",
            credential: { token, ca: "invalid" },
          };
        await assert.rejects(
          configureRuntimeConnections(home, value, command),
          (error: unknown) =>
            error instanceof ConnectionsConfigurationError &&
            error.code === "connections_configuration_invalid",
        );
        assert.equal(nativeCalls, 0);
        assert.equal(
          await readFile(join(directory, "runtime.json"), "utf8"),
          '{"token":"old"}',
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});

await test("uncertain native mutation retains delivered credential and explicit reapply can repair partial private content", async (t) => {
  const home = await fixture();
  t.after(() => rm(home, { recursive: true, force: true }));
  const state = join(home, ".openclaw");
  let calls = 0;
  await assert.rejects(
    configureRuntimeConnections(
      home,
      { ...input, kind: "configure", credential: { token } },
      () => {
        calls++;
        return Promise.reject(
          new Error(`Vendor diagnostic containing ${token}`),
        );
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConnectionsConfigurationError);
      assert.equal(error.code, "connections_configuration_incomplete");
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(await loadConnectionsCredential(state), { token });
  const credentialPath = join(state, "clawscarf-connections/runtime.json");
  await writeFile(credentialPath, "incomplete JSON");
  await assert.rejects(
    configureRuntimeConnections(
      home,
      { ...input, kind: "observe" },
      nativeCommand,
    ),
  );
  assert.equal(await readFile(credentialPath, "utf8"), "incomplete JSON");
  assert.equal(
    (
      await configureRuntimeConnections(
        home,
        { ...input, kind: "configure", credential: { token } },
        nativeCommand,
      )
    ).credentialMatches,
    true,
  );
  await assert.rejects(
    configureRuntimeConnections(
      home,
      { ...input, kind: "configure", credential: { token } },
      async (request, directory) => {
        const result = await nativeCommand(request, directory);
        await writeFile(credentialPath, '{"token":"unexpected"}');
        return result;
      },
    ),
    (error: unknown) =>
      error instanceof ConnectionsConfigurationError &&
      error.code === "connections_configuration_incomplete",
  );
});

await test("runtime command validates stdin and emits only generic structured failure", async () => {
  assert.equal(
    connectionsConfigurationInputSchema.safeParse({
      ...input,
      kind: "configure",
    }).success,
    false,
  );
  const executable = fileURLToPath(
    new URL("../../runtime/configure-connections-main.ts", import.meta.url),
  );
  const child = execute(process.execPath, ["--import", "tsx", executable]);
  child.child.stdin?.end('{"token":"secret-not-for-diagnostics",');
  await assert.rejects(child, (error: unknown) => {
    assert.ok(error instanceof Error && "stdout" in error && "stderr" in error);
    assert.equal(
      error.stdout,
      '{"error":"connections_configuration_invalid"}\n',
    );
    assert.equal(error.stderr, "");
    return true;
  });
});

await test("explicit capability disable and enable retain scoped credentials and unrelated native policy", async (t) => {
  const home = await fixture();
  t.after(() => rm(home, { recursive: true, force: true }));
  const configured = await configureRuntimeConnections(
    home,
    { ...input, kind: "configure", enable: true, credential: { token } },
    nativeCommand,
  );
  assert.ok(configured.state === "configured" && configured.enabled);
  const credential = await loadConnectionsCredential(join(home, ".openclaw"));
  const disabled = await configureRuntimeConnections(
    home,
    { ...input, kind: "disable" },
    nativeCommand,
  );
  assert.ok(disabled.state !== "not_installed" && !disabled.enabled);
  assert.deepEqual(
    await loadConnectionsCredential(join(home, ".openclaw")),
    credential,
  );
  const restored = await configureRuntimeConnections(
    home,
    { ...input, kind: "configure", enable: true, credential: { token } },
    nativeCommand,
  );
  assert.ok(
    restored.state === "configured" &&
      restored.enabled &&
      restored.credentialMatches,
  );
  const native = z
    .object({ browser: z.unknown(), tools: z.unknown() })
    .parse(
      JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8")),
    );
  assert.deepEqual(native.browser, nativeInitial.browser);
  assert.deepEqual(native.tools, nativeInitial.tools);
});
