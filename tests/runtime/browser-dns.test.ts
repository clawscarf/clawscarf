import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
async function docker(args: string[]) {
  return (
    await exec("docker", args, { timeout: 30_000, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
}
const confinement = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--memory=128m",
  "--cpus=0.5",
  "--pids-limit=32",
  "--sysctl=net.ipv4.ip_unprivileged_port_start=53",
  "--sysctl=net.ipv4.ip_forward=0",
];
const replySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), addresses: z.array(z.string()).min(1) }),
  z.object({ ok: z.literal(false), code: z.string() }),
]);
async function query(
  container: string,
  server: string,
  name: string,
  family: "A" | "AAAA" = "A",
) {
  const script = `
    import { Resolver } from 'node:dns/promises';
    const resolver = new Resolver({ timeout: 1500, tries: 1 });
    resolver.setServers([process.argv[1]]);
    try {
      const addresses = await resolver.resolve(process.argv[2], process.argv[3]);
      console.log(JSON.stringify({ ok: true, addresses }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: error.code }));
    }
  `;
  return replySchema.parse(
    JSON.parse(
      await docker([
        "exec",
        container,
        "node",
        "--input-type=module",
        "-e",
        script,
        server,
        name,
        family,
      ]),
    ),
  );
}

await test("DNS recipe requires an explicit deployment and pins the maintained resolver", async () => {
  const recipe = await readFile("deploy/execution/dns/Dockerfile", "utf8");
  assert.match(recipe, /unbound=1\.17\.1-2\+deb12u4/);
  assert.match(recipe, /USER unbound/);
  assert.match(recipe, /bookworm-slim@sha256:[a-f0-9]{64}/);
  const config = await readFile("deploy/execution/dns/unbound.conf", "utf8");
  assert.match(config, /include-toplevel: "\/etc\/unbound\/deployment\.conf"/);
  assert.doesNotMatch(config, /forward-addr:|interface:/);
});

await test(
  "private DNS serves only the isolated node, filters answers and never falls back",
  {
    skip: !process.env.CLAWSCARF_TEST_BROWSER_DNS_IMAGE,
    timeout: 180_000,
  },
  async (t) => {
    const image = process.env.CLAWSCARF_TEST_BROWSER_DNS_IMAGE;
    assert.ok(image);
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-browser-dns-"));
    const prefix = `clawscarf-dns-${randomUUID()}`;
    const internal = `${prefix}-internal`,
      outbound = `${prefix}-outbound`;
    const resolver = `${prefix}-resolver`,
      upstream = `${prefix}-upstream`;
    const allowed = `${prefix}-node`,
      denied = `${prefix}-denied`;
    const subnet = `10.${randomInt(180, 230)}.${randomInt(1, 255)}`;
    const resolverIp = `${subnet}.2`,
      allowedIp = `${subnet}.10`;
    const resources: {
      kind: "container" | "network";
      name: string;
      state: "pending" | "created" | "removed";
    }[] = [];
    const persist = async () =>
      await writeFile(
        join(directory, "resources.json"),
        JSON.stringify(resources, null, 2),
        { mode: 0o600 },
      );
    const allocate = async (
      kind: "container" | "network",
      name: string,
      args: string[],
    ) => {
      const receipt = { kind, name, state: "pending" as const };
      const index = resources.push(receipt) - 1;
      await persist();
      await docker(args);
      resources[index] = { kind, name, state: "created" };
      await persist();
    };
    t.after(async () => {
      const failures: Error[] = [];
      for (const kind of ["container", "network"] as const) {
        for (const resource of [...resources]
          .reverse()
          .filter((value) => value.kind === kind)) {
          if (resource.state === "removed") continue;
          if (resource.state === "pending") {
            failures.push(
              new Error(`Inspect unconfirmed ${kind} ${resource.name}.`),
            );
            continue;
          }
          try {
            await docker(
              kind === "container"
                ? ["rm", "-f", resource.name]
                : ["network", "rm", resource.name],
            );
            resource.state = "removed";
            await persist();
          } catch {
            failures.push(
              new Error(`Could not remove ${kind} ${resource.name}.`),
            );
          }
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          `DNS test cleanup incomplete; retained ${directory}`,
        );
      await rm(directory, { recursive: true, force: true });
    });
    await allocate("network", internal, [
      "network",
      "create",
      "--internal",
      "--subnet",
      `${subnet}.0/24`,
      "--opt",
      "com.docker.network.bridge.gateway_mode_ipv4=isolated",
      internal,
    ]);
    await allocate("network", outbound, ["network", "create", outbound]);
    const fixture = join(directory, "upstream.conf");
    await writeFile(
      fixture,
      `server:
    interface: 0.0.0.0@53
    access-control: 0.0.0.0/0 allow
    username: ""
    chroot: ""
    pidfile: ""
    use-syslog: no
    logfile: ""
    verbosity: 0
    do-ip6: no
    module-config: "iterator"
    local-zone: "fixture.clawscarf.test." static
    local-data: "public.fixture.clawscarf.test. 30 IN A 93.184.215.14"
    local-data: "loopback.fixture.clawscarf.test. 30 IN A 127.0.0.1"
    local-data: "metadata.fixture.clawscarf.test. 30 IN A 169.254.169.254"
    local-data: "private.fixture.clawscarf.test. 30 IN A 10.1.2.3"
    local-data: "loopback6.fixture.clawscarf.test. 30 IN AAAA ::1"
    local-data: "mapped.fixture.clawscarf.test. 30 IN AAAA ::ffff:169.254.169.254"
    local-data: "mixed.fixture.clawscarf.test. 30 IN A 93.184.215.14"
    local-data: "mixed.fixture.clawscarf.test. 30 IN A 169.254.169.254"
remote-control:
    control-enable: no
forward-zone:
    name: "."
    forward-first: no
    forward-addr: 1.1.1.1@53
`,
    );
    await allocate("container", upstream, [
      "run",
      "-d",
      "--name",
      upstream,
      "--network",
      outbound,
      ...confinement,
      "--mount",
      `type=bind,src=${fixture},dst=/etc/unbound/clawscarf.conf,readonly`,
      image,
    ]);
    const upstreamIp = await docker([
      "inspect",
      "--format",
      `{{(index .NetworkSettings.Networks "${outbound}").IPAddress}}`,
      upstream,
    ]);
    assert.match(upstreamIp, /^\d+\.\d+\.\d+\.\d+$/);
    const deployment = join(directory, "deployment.conf");
    await writeFile(
      deployment,
      `server:
    interface: ${resolverIp}@53
    access-control: ${allowedIp}/32 allow
forward-zone:
    name: "."
    forward-first: no
    forward-addr: ${upstreamIp}@53
`,
    );
    await allocate("container", resolver, [
      "run",
      "-d",
      "--name",
      resolver,
      "--network",
      `name=${internal},ip=${resolverIp}`,
      "--network",
      outbound,
      ...confinement,
      "--mount",
      `type=bind,src=${deployment},dst=/etc/unbound/deployment.conf,readonly`,
      image,
    ]);
    const resolv = join(directory, "resolv.conf");
    await writeFile(
      resolv,
      `nameserver ${resolverIp}\noptions timeout:2 attempts:1\n`,
    );
    for (const [name, ip] of [
      [allowed, allowedIp],
      [denied, `${subnet}.11`],
    ] as const) {
      await allocate("container", name, [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        `name=${internal},ip=${ip}`,
        ...confinement,
        "--user=node",
        "--mount",
        `type=bind,src=${resolv},dst=/etc/resolv.conf,readonly`,
        "--entrypoint=node",
        image,
        "-e",
        "setInterval(() => {}, 60000)",
      ]);
    }
    let ready = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await query(
        allowed,
        resolverIp,
        "public.fixture.clawscarf.test",
      );
      if (response.ok) {
        ready = true;
        break;
      }
      await delay(100);
    }
    assert.ok(ready, "The explicitly configured resolver must become ready.");
    await docker([
      "exec",
      resolver,
      "unbound-checkconf",
      "/etc/unbound/clawscarf.conf",
    ]);
    const publicAnswer = await query(allowed, resolverIp, "example.com");
    assert.equal(
      publicAnswer.ok,
      true,
      "The real configured public forwarder must answer.",
    );
    const nativeLookup = await docker([
      "exec",
      allowed,
      "node",
      "--input-type=module",
      "-e",
      "import {lookup} from 'node:dns/promises'; console.log(JSON.stringify(await lookup('example.com',{family:4,all:true})))",
    ]);
    assert.ok(
      z
        .array(z.object({ address: z.string(), family: z.literal(4) }))
        .min(1)
        .parse(JSON.parse(nativeLookup)).length,
    );
    assert.deepEqual(await query(denied, resolverIp, "example.com"), {
      ok: false,
      code: "EREFUSED",
    });
    for (const name of ["loopback", "metadata", "private"]) {
      assert.equal(
        (await query(upstream, "127.0.0.1", `${name}.fixture.clawscarf.test`))
          .ok,
        true,
      );
      const filtered = await query(
        allowed,
        resolverIp,
        `${name}.fixture.clawscarf.test`,
      );
      assert.equal(
        filtered.ok,
        false,
        `Private ${name} answers must not leave the resolver.`,
      );
      if (!filtered.ok) assert.equal(filtered.code, "ENODATA");
    }
    for (const name of ["loopback6", "mapped"]) {
      assert.equal(
        (
          await query(
            upstream,
            "127.0.0.1",
            `${name}.fixture.clawscarf.test`,
            "AAAA",
          )
        ).ok,
        true,
      );
      const filtered = await query(
        allowed,
        resolverIp,
        `${name}.fixture.clawscarf.test`,
        "AAAA",
      );
      assert.deepEqual(filtered, { ok: false, code: "ENODATA" });
    }
    assert.deepEqual(await query(allowed, resolverIp, "localhost"), {
      ok: false,
      code: "EREFUSED",
    });
    assert.deepEqual(
      await query(allowed, resolverIp, "mixed.fixture.clawscarf.test"),
      { ok: true, addresses: ["93.184.215.14"] },
    );
    const probe = `import net from 'node:net'; const socket=net.connect({host:process.argv[1],port:443}); socket.setTimeout(2500); socket.once('connect',()=>{console.log('connected');socket.destroy()}); socket.once('error',error=>console.log(error.code)); socket.once('timeout',()=>{console.log('timeout');socket.destroy()});`;
    assert.equal(
      await docker([
        "exec",
        upstream,
        "node",
        "--input-type=module",
        "-e",
        probe,
        "1.1.1.1",
      ]),
      "connected",
    );
    assert.equal(
      await docker([
        "exec",
        allowed,
        "node",
        "--input-type=module",
        "-e",
        probe,
        "1.1.1.1",
      ]),
      "ENETUNREACH",
    );
    const status = await docker([
      "exec",
      resolver,
      "node",
      "--input-type=module",
      "-e",
      "import fs from 'node:fs'; console.log(fs.readFileSync('/proc/1/status','utf8'))",
    ]);
    assert.match(status, /^Uid:\s+[1-9][0-9]*\s/m);
    assert.match(status, /^CapEff:\s+0000000000000000$/m);
    assert.match(status, /^NoNewPrivs:\s+1$/m);
    assert.doesNotMatch(
      await docker(["logs", resolver]),
      /example\.com|fixture\.clawscarf\.test/,
    );
    await docker(["stop", upstream]);
    const unavailable = await query(allowed, resolverIp, "www.iana.org");
    assert.equal(
      unavailable.ok,
      false,
      "An unavailable fixed forwarder must not trigger recursion or another resolver.",
    );
  },
);
