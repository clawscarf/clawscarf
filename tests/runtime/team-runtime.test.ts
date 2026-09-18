import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { initialConfiguration } from "../../runtime/configuration.js";
const execute = promisify(execFile);

await test(
  "native uploads, local tools and Lobster share the protected persistent runtime",
  {
    skip: process.env.CLAWSCARF_TEST_TEAM_RUNTIME !== "1",
    timeout: 240000,
  },
  async () => {
    const cli = process.env.CLAWSCARF_TEST_OPENSHELL;
    const controller = process.env.CLAWSCARF_TEST_GATEWAY;
    const image = process.env.CLAWSCARF_TEST_RUNTIME_IMAGE;
    assert.ok(cli && controller && image);
    assert.match(image, /^(sha256:|[^\s]+@sha256:)[a-f0-9]{64}$/);
    assert.equal(
      Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")),
      false,
    );
    const name = "cst-" + randomUUID().replaceAll("-", "").slice(0, 15);
    const volume = name + "-home";
    const shell = async (args: string[], input?: string) => {
      const task = execute(cli, ["--gateway", controller, ...args], {
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      });
      task.child.stdin?.end(input);
      return (await task).stdout;
    };
    const inside = async (args: string[]) => {
      const task = execute(
        cli,
        [
          "sandbox",
          "exec",
          "--name",
          name,
          "--gateway",
          controller,
          "--no-tty",
          "--timeout",
          "160",
          "--",
          ...args,
        ],
        { timeout: 175000, maxBuffer: 4 * 1024 * 1024 },
      );
      task.child.stdin?.end();
      return (await task).stdout;
    };
    await execute("docker", [
      "volume",
      "create",
      "--label",
      `clawscarf.test=${name}`,
      volume,
    ]);
    try {
      await shell([
        "sandbox",
        "create",
        "--name",
        name,
        "--from",
        image,
        "--policy",
        resolve("deploy/openshell/policy.yaml"),
        "--cpu",
        "2",
        "--memory",
        "3Gi",
        "--no-auto-providers",
        "--detach",
        "--no-tty",
        "--label",
        `clawscarf.test=${name}`,
        "--driver-config-json",
        JSON.stringify({
          docker: {
            mounts: [
              {
                type: "volume",
                source: volume,
                target: "/home/node",
                read_only: false,
              },
            ],
          },
        }),
        "--",
        "node",
        "-e",
        "setInterval(()=>{},1000)",
      ]);
      const preset = initialConfiguration({
        publicOrigin: "http://127.0.0.1:18789",
        widgetOrigin: "http://127.0.0.1:18790",
        administratorIdentity: "clawscarf:proof-admin",
        standaloneNavigation: false,
      });
      await inside([
        "node",
        "-e",
        "require('node:fs').writeFileSync('/home/node/team-runtime-preset.json',process.argv[1])",
        JSON.stringify(preset),
      ]);
      const source = await readFile(
        new URL("./team-runtime-probe.mjs", import.meta.url),
        "utf8",
      );
      await inside([
        "node",
        "-e",
        "require('node:fs').writeFileSync('/home/node/team-runtime-probe.mjs',process.argv[1])",
        source,
      ]);
      const result = await inside([
        "node",
        "/home/node/team-runtime-probe.mjs",
      ]);
      assert.match(result, /outer confinement passed/);
      await shell(["sandbox", "stop", name]);
      await shell(["sandbox", "start", name]);
      const retained = await inside([
        "node",
        "-e",
        `const fs=require('node:fs');const root='/home/node/.openclaw/workspace/';const proof=JSON.parse(fs.readFileSync(root+'team-runtime-proof.json'));require('node:assert/strict').equal(fs.readFileSync(root+'edited.txt','utf8'),proof.nonce+' edited');require('node:assert/strict').equal(fs.readFileSync(proof.uploaded,'utf8'),proof.nonce);console.log('retained')`,
      ]);
      assert.equal(retained.trim(), "retained");
    } finally {
      // Exact random names owned by this fixture only. Also delete failed allocations.
      await shell(["sandbox", "delete", name]);
      await execute("docker", ["volume", "rm", volume]);
    }
  },
);
