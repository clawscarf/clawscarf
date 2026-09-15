import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const packageDirectory = resolve(import.meta.dirname, "..");

await test("native configuration preserves authored policy, disablement and unrelated state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-configuration-"));
  const configPath = join(directory, "openclaw.json");
  const state = join(directory, "state");
  await mkdir(state);
  const initial = {
    gateway: { mode: "local" },
    browser: { enabled: false },
    plugins: { entries: { "clawscarf-connections": { enabled: false } } },
    tools: { sandbox: { tools: { allow: ["read"], deny: ["exec"] } } },
  };
  const command = (
    kind: "configure" | "observe",
    brokerUrl = "http://127.0.0.1:8800/_clawscarf/connections/",
  ) =>
    new Promise<string>((resolveOutput, reject) => {
      const child = spawn(
        process.execPath,
        [join(packageDirectory, "dist/configuration-command.js")],
        {
          env: {
            ...process.env,
            HOME: directory,
            OPENCLAW_STATE_DIR: state,
            OPENCLAW_CONFIG_PATH: configPath,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      let diagnostic = "";
      child.stdout.setEncoding("utf8").on("data", (value: string) => {
        output += value;
      });
      child.stderr.setEncoding("utf8").on("data", (value: string) => {
        diagnostic += value;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolveOutput(output)
          : reject(new Error(`${output} ${diagnostic}`)),
      );
      child.stdin.end(
        JSON.stringify({
          kind,
          brokerUrl,
          packageDirectory,
          replacePackageDirectories: [],
        }),
      );
    });
  try {
    await writeFile(configPath, JSON.stringify(initial));
    const before = await readFile(configPath, "utf8");
    for (const brokerUrl of [
      "https://broker.example/_clawscarf/connections?token=secret",
      "https://broker.example/_clawscarf/connections#fragment",
      "https://user:secret@broker.example/_clawscarf/connections",
      "http://broker.example/_clawscarf/connections",
    ]) {
      await assert.rejects(command("configure", brokerUrl));
      assert.equal(await readFile(configPath, "utf8"), before);
    }
    await command("observe");
    assert.equal(await readFile(configPath, "utf8"), before);
    const configured: unknown = JSON.parse(await command("configure"));
    assert.ok(
      configured &&
        typeof configured === "object" &&
        "state" in configured &&
        configured.state === "configured",
    );
    const expected = {
      ...initial,
      plugins: {
        load: { paths: [packageDirectory] },
        entries: {
          "clawscarf-connections": {
            enabled: false,
            config: {
              brokerUrl: "http://127.0.0.1:8800/_clawscarf/connections",
              credential: {
                source: "env",
                provider: "clawscarf-connections",
                id: "CLAWSCARF_CONNECTIONS_TOKEN",
              },
            },
          },
        },
      },
      secrets: {
        providers: {
          "clawscarf-connections": {
            source: "env",
            allowlist: ["CLAWSCARF_CONNECTIONS_TOKEN"],
          },
        },
      },
    };
    // Native bookkeeping may add metadata; inspect the policy-bearing fields.
    const applied: unknown = JSON.parse(await readFile(configPath, "utf8"));
    assert.ok(applied && typeof applied === "object");
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(key in applied);
      assert.deepEqual(Reflect.get(applied, key), value);
    }
    await command("configure");
    const after = await readFile(configPath, "utf8");
    await command("observe");
    assert.equal(await readFile(configPath, "utf8"), after);
    assert.ok(
      configured && "enabled" in configured && configured.enabled === false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
