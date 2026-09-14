import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
await test(
  "OpenShell policy denies privileged paths/egress and retains owned volume across restart",
  {
    skip: process.env.CLAWSCARF_TEST_RUNTIME_BOUNDARY !== "1",
    timeout: 180_000,
  },
  async () => {
    const cli = process.env.CLAWSCARF_TEST_OPENSHELL;
    const gateway = process.env.CLAWSCARF_TEST_GATEWAY;
    const image = process.env.CLAWSCARF_TEST_RUNTIME_IMAGE;
    assert.ok(
      cli && gateway && image,
      "Set the documented runtime test inputs.",
    );
    assert.match(image, /^(sha256:|[^\s]+@sha256:)[a-f0-9]{64}$/);
    assert.equal(
      Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")),
      false,
      "Use isolated XDG configuration and explicit test gateway; unset OPENSHELL_* overrides.",
    );
    const release: unknown = JSON.parse(
      await readFile("release/components.json", "utf8"),
    );
    const pin = z
      .object({ openshell: z.object({ version: z.string() }) })
      .parse(release);
    const version = await execute(cli, ["--version"], { timeout: 10_000 });
    assert.ok(
      version.stdout.trim().split(/\s+/).includes(pin.openshell.version),
    );
    await execute("docker", ["image", "inspect", image], { timeout: 10_000 });
    await execute(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--entrypoint",
        "node",
        image,
        "-e",
        `
        const socket=require('node:net').connect({host:'1.1.1.1',port:443});
        socket.setTimeout(5000);
        socket.once('connect',()=>socket.end());
        socket.once('error',()=>process.exit(1));
        socket.once('timeout',()=>process.exit(1));
      `,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const name = `csb-${randomUUID().replaceAll("-", "").slice(0, 15)}`;
    const volume = name + "-home";
    const run = async (...args: string[]) =>
      execute(cli, [...args, "--gateway", gateway], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
    const exec = async (source: string) => {
      const pending = execute(
        cli,
        [
          "sandbox",
          "exec",
          "--name",
          name,
          "--gateway",
          gateway,
          "--no-tty",
          "--timeout",
          "25",
          "--",
          "node",
          "--input-type=module",
          "-e",
          source,
        ],
        { timeout: 35_000, maxBuffer: 1024 * 1024 },
      );
      pending.child.stdin?.end();
      return await pending;
    };
    let created = false;
    await execute(
      "docker",
      ["volume", "create", "--label", `clawscarf.test=${name}`, volume],
      { timeout: 10_000 },
    );
    try {
      await execute(
        cli,
        [
          "sandbox",
          "create",
          "--name",
          name,
          "--gateway",
          gateway,
          "--from",
          image,
          "--policy",
          resolve("deploy/openshell/policy.yaml"),
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
          "node",
          "-e",
          "setInterval(()=>{},1000)",
        ],
        { timeout: 60_000, maxBuffer: 1024 * 1024 },
      );
      created = true;
      const before = await exec(`
      import assert from 'node:assert/strict';
      import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
      import {connect} from 'node:net';
      assert.equal(process.getuid(),1000);
      const status=await readFile('/proc/self/status','utf8');
      assert.match(status,/NoNewPrivs:\\s+1/);
        assert.equal((await readFile('/sys/fs/cgroup/memory.max','utf8')).trim(),'536870912');
        const [quota,period]=(await readFile('/sys/fs/cgroup/cpu.max','utf8')).trim().split(/\\s+/).map(Number);
        assert.equal(quota/period,1);
      await writeFile('/tmp/clawscarf-policy-positive','ok');
      await assert.rejects(writeFile('/var/tmp/clawscarf-denied','no'), {code:'EACCES'});
      await assert.rejects(writeFile('/app/clawscarf-denied','no'), {code:'EACCES'});
      for (const path of ['/var/run/docker.sock','/run/docker.sock','/root/.ssh']) {
        await assert.rejects(stat(path), error => ['EACCES','ENOENT'].includes(error.code));
      }
      const outcome=await new Promise(resolve=>{
        const socket=connect({host:'1.1.1.1',port:443});
        socket.setTimeout(5000);
        socket.once('connect',()=>{socket.destroy();resolve('connected');});
        socket.once('error',error=>resolve(error.code));
        socket.once('timeout',()=>{socket.destroy();resolve('timeout');});
      });
      assert.ok(['EACCES','EPERM','ECONNREFUSED'].includes(outcome),'Expected explicit network denial, got '+outcome);
      await mkdir('/home/node/.openclaw/workspace',{recursive:true});
      await writeFile('/home/node/.openclaw/workspace/retained',${JSON.stringify(name)},{flag:'wx'});
      console.log('boundary passed');
    `);
      assert.equal(before.stdout.trim(), "boundary passed");

      await run("sandbox", "stop", name);
      await run("sandbox", "start", name);
      const after = await exec(`
      import assert from 'node:assert/strict';
      import {readFile} from 'node:fs/promises';
      assert.equal(await readFile('/home/node/.openclaw/workspace/retained','utf8'),${JSON.stringify(name)});
      assert.equal(process.getuid(),1000);
      console.log('retention passed');
    `);
      assert.equal(after.stdout.trim(), "retention passed");
    } finally {
      if (created) await run("sandbox", "delete", name);
      else
        console.error(
          `Sandbox creation was not confirmed; inspect only ${name} before cleanup.`,
        );
      await execute("docker", ["volume", "rm", volume], { timeout: 10_000 });
    }
  },
);
