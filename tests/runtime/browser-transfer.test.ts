import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { browserArtifactsVolumeOptions } from "../../scripts/deployment/browser-node.js";

async function docker(args: string[], input?: string): Promise<string> {
  return await new Promise((accept, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    child.stdout.setEncoding("utf8").on("data", (part: string) => {
      output += part;
    });
    child.stderr.setEncoding("utf8").on("data", (part: string) => {
      error += part;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(Error(`Docker failed (${code}): ${error}\n${output}`)),
    );
    child.stdin.end(input);
  });
}

const browserImage = process.env.CLAWSCARF_TEST_BROWSER_IMAGE;
const nodeImage = process.env.CLAWSCARF_TEST_BROWSER_NODE_IMAGE;
await test(
  "native uploads and downloads cross isolated Chromium/controller/workspace filesystems",
  {
    skip: !browserImage || !nodeImage,
    timeout: 180000,
  },
  async () => {
    assert.ok(browserImage && nodeImage);
    const name = `cs-browser-transfer-${randomUUID()}`;
    const state = `${name}-state`,
      artifacts = `${name}-artifacts`;
    const browser = `${name}-browser`,
      controller = `${name}-controller`,
      gateway = `${name}-gateway`;
    const token = randomBytes(32).toString("hex");
    const label = "io.clawscarf.test=browser-transfer";
    const fixture = `${resolve("tests/runtime/browser-transfer.mjs")}:/fixture.mjs:ro`;
    const bounded = [
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=1000:1000",
      "--init",
      "--memory=1g",
      "--pids-limit=256",
    ];
    try {
      await docker(["network", "create", "--internal", "--label", label, name]);
      await docker(["volume", "create", "--label", label, state]);
      await docker([
        "volume",
        "create",
        "--label",
        label,
        "--driver=local",
        ...Object.entries(browserArtifactsVolumeOptions).map(
          ([key, value]) => `--opt=${key}=${value}`,
        ),
        artifacts,
      ]);
      await docker(
        [
          "run",
          "--rm",
          "-i",
          "--network=none",
          "--user=0",
          "--mount",
          `source=${state},target=/state`,
          "--entrypoint=node",
          nodeImage,
          "-e",
          'const fs=require("fs");let input="";process.stdin.on("data",p=>input+=p).on("end",()=>{fs.writeFileSync("/state/token",input,{mode:0o600});fs.chownSync("/state/token",1000,1000);fs.chownSync("/state",1000,1000)})',
        ],
        token,
      );
      await docker([
        "run",
        "-d",
        "--name",
        browser,
        "--label",
        label,
        "--network",
        name,
        "--network-alias=browser",
        ...bounded,
        "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
        "--shm-size=256m",
        `--security-opt=seccomp=${resolve("deploy/execution/browser/seccomp.json")}`,
        "--mount",
        `source=${state},target=/state`,
        "--mount",
        `source=${artifacts},target=/browser-artifacts`,
        "-e",
        "CLAWSCARF_BROWSER_TOKEN_FILE=/state/token",
        browserImage,
      ]);
      const controllerArgs = [
        "run",
        "-d",
        "--name",
        controller,
        "--label",
        label,
        "--network",
        name,
        "--network-alias=controller",
        "--network-alias=fixture.test",
        ...bounded,
        "--tmpfs=/tmp:rw,nosuid,nodev,size=128m",
        "--tmpfs=/state:uid=1000,gid=1000,mode=0700",
        "-v",
        fixture,
        "-e",
        `FIXTURE_CDP_TOKEN=${token}`,
        "-e",
        "OPENCLAW_CONFIG_PATH=/state/openclaw.json",
        "-e",
        "OPENCLAW_BROWSER_SHARED_ARTIFACTS_DIR=/browser-artifacts",
        "--entrypoint=node",
      ];
      await docker([
        ...controllerArgs,
        "--mount",
        `source=${artifacts},target=/browser-artifacts`,
        nodeImage,
        "/fixture.mjs",
        "controller",
      ]);
      const ready = async () => {
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            await docker([
              "exec",
              controller,
              "node",
              "-e",
              'fetch("http://127.0.0.1:9000",{signal:AbortSignal.timeout(500)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))',
            ]);
            return;
          } catch {
            await delay(250);
          }
        }
        throw Error(
          `Controller did not start: ${await docker(["logs", controller])}`,
        );
      };
      const roundTrip = () =>
        docker([
          "run",
          "--rm",
          "--name",
          gateway,
          "--label",
          label,
          "--network",
          name,
          ...bounded,
          "--tmpfs=/tmp:rw,nosuid,nodev,size=128m",
          "--tmpfs=/state:uid=1000,gid=1000,mode=0700",
          "--tmpfs=/workspace:uid=1000,gid=1000,mode=0700",
          "-v",
          fixture,
          "--entrypoint=node",
          nodeImage,
          "/fixture.mjs",
          "gateway",
        ]);
      await ready();
      assert.match(await roundTrip(), /"download":"workspace round trip"/);
      await docker(["restart", controller]);
      await ready();
      assert.match(await roundTrip(), /"cleanup":"empty"/);
      await docker(["rm", "-f", controller]);
      await docker([
        ...controllerArgs,
        nodeImage,
        "/fixture.mjs",
        "controller",
      ]);
      await ready();
      await assert.rejects(roundTrip(), /browser-artifacts|ENOENT/);
    } finally {
      await docker(["rm", "-f", gateway, controller, browser]).catch(() => {});
      await docker(["network", "rm", name]).catch(() => {});
      await docker(["volume", "rm", artifacts, state]);
    }
  },
);
