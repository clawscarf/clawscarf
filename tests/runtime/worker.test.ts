import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

await test(
  "shared SSH worker confines commands, authenticates keys and retains its home",
  {
    skip: process.env.CLAWSCARF_TEST_SSH_WORKER !== "1",
    timeout: 180_000,
  },
  async () => {
    const cli = process.env.CLAWSCARF_TEST_OPENSHELL;
    const gateway = process.env.CLAWSCARF_TEST_GATEWAY;
    const image = process.env.CLAWSCARF_TEST_WORKER_IMAGE;
    const deniedPort = Number(process.env.CLAWSCARF_TEST_DENIED_HOST_PORT);
    assert.ok(
      cli && gateway && image,
      "Set the documented worker test inputs.",
    );
    assert.match(image, /^(sha256:|[^\s]+@sha256:)[a-f0-9]{64}$/);
    assert.ok(
      Number.isInteger(deniedPort) && deniedPort > 0 && deniedPort < 65536,
    );
    assert.equal(
      Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")),
      false,
      "Use isolated XDG configuration and explicit gateway; unset OPENSHELL_* overrides.",
    );
    await execute("docker", ["image", "inspect", image], { timeout: 10_000 });
    // Establish a live host endpoint before interpreting worker denial as isolation.
    await execute(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--entrypoint",
        "node",
        image,
        "-e",
        `const s=require('node:net').connect({host:'host.docker.internal',port:${String(deniedPort)}});s.setTimeout(3000);s.on('connect',()=>s.end());s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));`,
      ],
      { timeout: 10_000 },
    );
    const name = `csssh-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const volume = `${name}-home`;
    await mkdir(".local", { recursive: true });
    const directory = await mkdtemp(resolve(".local", "worker-test-"));
    const port = await availablePort();
    let created = false;
    let forward: ChildProcess | undefined;
    const run = async (...args: string[]) =>
      execute(cli, ["--gateway", gateway, ...args], { timeout: 60_000 });
    const ssh = async (command: string, key = "client") =>
      execute(
        "ssh",
        [
          "-F",
          "/dev/null",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=5",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `UserKnownHostsFile=${directory}/known_hosts`,
          "-o",
          "IdentitiesOnly=yes",
          "-i",
          `${directory}/${key}`,
          "-p",
          String(port),
          "node@127.0.0.1",
          command,
        ],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
    const startForward = async () => {
      const child = spawn(
        cli,
        ["forward", "start", String(port), name, "--gateway", gateway],
        {
          stdio: "ignore",
        },
      );
      forward = child;
      let startupError: Error | undefined;
      child.on("error", (error) => {
        startupError = error;
      });
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        if (startupError) throw startupError;
        assert.equal(
          child.exitCode,
          null,
          "Forward stopped before accepting connections.",
        );
        if (await listening(port)) return;
        await delay(100);
      }
      assert.fail("Worker forward did not start.");
    };
    const waitForSsh = async () => {
      const until = Date.now() + 15_000;
      while (true) {
        try {
          await ssh("true");
          return;
        } catch (error) {
          if (Date.now() >= until) throw error;
          await delay(100);
        }
      }
    };
    try {
      for (const key of ["client", "wrong", "host_ed25519"]) {
        await execute("ssh-keygen", [
          "-q",
          "-t",
          "ed25519",
          "-N",
          "",
          "-f",
          `${directory}/${key}`,
        ]);
      }
      const hostKey = (
        await readFile(`${directory}/host_ed25519.pub`, "utf8")
      ).trim();
      await writeFile(
        `${directory}/known_hosts`,
        `[127.0.0.1]:${String(port)} ${hostKey}\n`,
        { mode: 0o600 },
      );
      await execute("docker", [
        "volume",
        "create",
        "--label",
        `clawscarf.test=${name}`,
        volume,
      ]);
      await execute(
        "docker",
        [
          "run",
          "--rm",
          "--user",
          "root",
          "--entrypoint",
          "/bin/sh",
          "--mount",
          `type=volume,src=${volume},dst=/home/node`,
          "--mount",
          `type=bind,src=${directory},dst=/seed,readonly`,
          image,
          "-c",
          "install -d -o node -g node -m 0700 /home/node/.clawscarf-worker; install -o node -g node -m 0600 /seed/host_ed25519 /home/node/.clawscarf-worker/host_ed25519; install -o node -g node -m 0600 /seed/client.pub /home/node/.clawscarf-worker/authorized_keys",
        ],
        { timeout: 15_000 },
      );
      await run(
        "sandbox",
        "create",
        "--name",
        name,
        "--from",
        image,
        "--policy",
        resolve("deploy/execution/worker/policy.yaml"),
        "--cpu",
        "1",
        "--memory",
        "512Mi",
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
        "/usr/sbin/sshd",
        "-D",
        "-e",
        "-f",
        "/etc/ssh/clawscarf_sshd_config",
        "-p",
        String(port),
      );
      created = true;
      await startForward();
      await waitForSsh();
      await assert.rejects(ssh("true", "wrong"), { code: 255 });
      const wrongHost = (
        await readFile(`${directory}/wrong.pub`, "utf8")
      ).trim();
      await writeFile(
        `${directory}/known_hosts`,
        `[127.0.0.1]:${String(port)} ${wrongHost}\n`,
      );
      await assert.rejects(ssh("true"), { code: 255 });
      await writeFile(
        `${directory}/known_hosts`,
        `[127.0.0.1]:${String(port)} ${hostKey}\n`,
      );
      const script = `
import os, pathlib, socket
assert os.getuid() == 1000 and os.getgid() == 1000
assert 0 not in os.getgroups(), os.getgroups()
assert sorted(p.name for p in pathlib.Path('/home/node/.clawscarf-worker').iterdir()) == ['authorized_keys', 'host_ed25519']
assert not pathlib.Path('/home/node/.openclaw').exists()
assert pathlib.Path('/proc/self/status').read_text().split('NoNewPrivs:')[1].splitlines()[0].strip() == '1'
for path in ['/root/.ssh', '/var/run/docker.sock', '/run/docker.sock']:
 try: pathlib.Path(path).stat()
 except OSError as error: assert error.errno in (2,13), error
 else: raise AssertionError(path)
try: pathlib.Path('/etc/worker-write-probe').write_text('denied')
except OSError as error: assert error.errno in (13,30), error
else: raise AssertionError('system files writable')
for host, port in [('host.docker.internal', ${String(deniedPort)}), ('1.1.1.1',443)]:
 connection=socket.socket(); connection.settimeout(3)
 result=connection.connect_ex((host,port)); connection.close()
 assert result in (1,13,111), (host,port,result)
pathlib.Path('/home/node/retained.txt').write_text('${name}')
print('worker boundary passed')
`;
      assert.equal(
        (await ssh(`python3 - <<'PY'\n${script}\nPY`)).stdout.trim(),
        "worker boundary passed",
      );
      await stop(forward);
      forward = undefined;
      await run("sandbox", "stop", name);
      await run("sandbox", "start", name);
      await startForward();
      await waitForSsh();
      assert.equal((await ssh("cat /home/node/retained.txt")).stdout, name);
    } finally {
      await stop(forward);
      if (created) {
        await run("sandbox", "delete", name);
        await execute("docker", ["volume", "rm", volume], { timeout: 10_000 });
        await rm(directory, { recursive: true, force: true });
      } else
        console.error(
          `Unconfirmed worker allocation: inspect only ${name} before cleanup.`,
        );
    }
  },
);

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}

async function listening(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
}
