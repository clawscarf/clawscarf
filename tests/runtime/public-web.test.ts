import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { initialRuntimePolicy } from "../../scripts/deployment/policy.js";

const execute = promisify(execFile);
await test(
  "OpenShell public-web policy permits proxied HTTPS and denies private destinations and disabled web",
  {
    skip: process.env.CLAWSCARF_TEST_PUBLIC_WEB !== "1",
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
    const name = `csweb-${randomUUID().slice(0, 12)}`;
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-web-"));
    const policy = join(directory, "policy.json");
    const source = await readFile("deploy/openshell/policy.yaml", "utf8");
    await writeFile(
      policy,
      JSON.stringify(initialRuntimePolicy(source, undefined, undefined, true)),
    );
    const run = async (args: string[]) =>
      execute(cli, args, { timeout: 60000, maxBuffer: 1024 * 1024 });
    const probe = async (url: string, expected: boolean) => {
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
          "20",
          "--env",
          "NODE_USE_ENV_PROXY=1",
          "--",
          "node",
          "--input-type=module",
          "-e",
          expected
            ? `import assert from 'node:assert/strict';
       const r = await fetch(${JSON.stringify(url)}, {signal: AbortSignal.timeout(8000)});
       await r.arrayBuffer(); assert.equal(r.ok, true);
       // Exercise OpenClaw's own guarded fetch with managed proxy routing too.
       const {readdir} = await import('node:fs/promises');
       async function exported(prefix, name) {
         for (const file of await readdir('/app/dist')) {
           if (!file.startsWith(prefix) || !file.endsWith('.mjs')) continue;
           const module = await import('/app/dist/'+file);
           if (typeof module[name] === 'function') return module[name];
         }
         throw new Error('Missing native export: '+name);
       }
       const startProxy = await exported('proxy-lifecycle-', 'startProxy');
       const fetchGuard = await exported('fetch-guard-', 'fetchWithSsrFGuard');
       const handle = await startProxy({enabled:true,proxyUrl:process.env.HTTPS_PROXY});
       assert.ok(handle);
       try {
         const result = await fetchGuard({url:${JSON.stringify(url)}, timeoutMs:8000});
         try { assert.equal(result.response.ok,true); await result.response.arrayBuffer(); }
         finally { await result.release(); }
       } finally { await handle.stop(); }
       console.log('confirmed');`
            : `import assert from 'node:assert/strict'; import http from 'node:http';
       const target = new URL(${JSON.stringify(url)});
       const proxy = new URL(process.env.HTTPS_PROXY);
       const request = http.request(proxy, {method:'CONNECT', path:target.hostname+':'+(target.port || (target.protocol==='https:'?'443':'80')), agent:false});
       request.setTimeout(8000, () => request.destroy(new Error('timeout')));
       request.on('connect', (response, socket) => { socket.destroy(); assert.equal(response.statusCode,403); console.log('confirmed'); });
       request.on('error', error => { throw error; }); request.end();`,
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      pending.child.stdin?.end();
      assert.match((await pending).stdout, /confirmed/u);
    };
    let created = false;
    try {
      await run([
        "sandbox",
        "create",
        "--name",
        name,
        "--gateway",
        gateway,
        "--from",
        image,
        "--policy",
        policy,
        "--cpu",
        "1",
        "--memory",
        "512Mi",
        "--no-auto-providers",
        "--detach",
        "--no-tty",
        "--label",
        `clawscarf.test=${name}`,
        "--",
        "node",
        "-e",
        "setInterval(()=>{},1000)",
      ]);
      created = true;
      await probe("https://example.com", true);
      await probe("http://example.com", true);
      for (const url of [
        "http://127.0.0.1",
        "http://169.254.169.254",
        "http://10.0.0.1",
        "http://192.168.0.1",
        "http://100.100.100.200",
        "http://[::1]",
        "http://[fc00::1]",
      ])
        await probe(url, false);
      await writeFile(
        policy,
        JSON.stringify(initialRuntimePolicy(source, undefined)),
      );
      await run([
        "policy",
        "set",
        name,
        "--gateway",
        gateway,
        "--policy",
        policy,
        "--wait",
      ]);
      await probe("https://example.com", false);
    } finally {
      if (created) await run(["sandbox", "delete", name, "--gateway", gateway]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
