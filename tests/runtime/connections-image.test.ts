import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const image = process.env.CLAWSCARF_TEST_CONNECTIONS_IMAGE;
await test(
  "packaged native Connections activation reaches a TLS broker after restart",
  { skip: !image, timeout: 180_000 },
  async (t) => {
    assert.ok(image);
    assert.match(image, /^sha256:[a-f0-9]{64}$/u);
    const directory = await mkdtemp(
      join(tmpdir(), "clawscarf-image-connections-"),
    );
    const name = `csconnections-${randomUUID().slice(0, 12)}`;
    t.after(async () => {
      try {
        const remaining = await execute(
          "docker",
          ["container", "ls", "--all", "--format", "{{.Names}}"],
          { timeout: 15_000 },
        );
        if (remaining.stdout.split("\n").includes(name))
          await execute("docker", ["rm", "--force", name], { timeout: 30_000 });
        await rm(directory, { recursive: true, force: true });
      } catch {
        throw new Error(
          `Image test cleanup failed; inspect container ${name}. Private fixtures retained at ${directory}.`,
        );
      }
    });
    await execute(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
      ],
      { timeout: 15_000 },
    );
    await chmod(join(directory, "key.pem"), 0o600);
    const result = await execute(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--user",
        "0:0",
        "--security-opt",
        "no-new-privileges:true",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--tmpfs",
        "/home/node:rw,nosuid,nodev,size=256m",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
        "--mount",
        `type=bind,source=${directory},target=/fixture,readonly`,
        "--mount",
        `type=bind,source=${resolve("tests/runtime/connections-image-probe.ts")},target=/probe.ts,readonly`,
        "--entrypoint",
        "node",
        image,
        "--experimental-strip-types",
        "/probe.ts",
      ],
      { timeout: 160_000, maxBuffer: 1024 * 1024 },
    );
    assert.match(result.stdout, /native search and retained restart passed/u);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-scoped-connection-token/u,
    );
  },
);
