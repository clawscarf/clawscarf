import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareExecution,
  executionDefaults,
} from "../../scripts/deployment/execution.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import { initializeWorkerHome } from "../../runtime/initialize-worker.js";
import { initializeHome } from "../../runtime/initialize.js";
import { initialRuntimePolicy } from "../../scripts/deployment/policy.js";
import { composeConfiguration } from "../../scripts/deployment/compose.js";
import type { LocalState } from "../../scripts/deployment/state.js";

const input = {
  name: "execution-test",
  administratorName: "Ada",
  runtimeImage: `sha256:${"a".repeat(64)}`,
  companionImage: `sha256:${"b".repeat(64)}`,
  openshellCli: "/tools/openshell",
  openshellGateway: "/tools/gateway",
  openshellClientImage: `sha256:${"a".repeat(64)}`,
  cpu: "1",
  memory: "2Gi",
  ports: {
    controller: 17211,
    application: 17212,
    widgets: 17213,
    management: 17214,
    native: 17215,
    nativeWidgets: 17216,
    database: 17217,
  },
  relayImage: `sha256:${"d".repeat(64)}`,
  execution: {
    image: `sha256:${"c".repeat(64)}`,
    port: 17218,
    cpu: "1",
    memory: "512Mi",
  },
};
const state: LocalState = {
  schemaVersion: 1,
  ownerId: "00000000-0000-4000-8000-000000000001",
  input: parseLocalInput(input),
};
const uid = process.getuid?.() ?? 1000,
  gid = process.getgid?.() ?? 1000;

await test("execution credentials stay separate, resume without rotation and reject changed keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-execution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const keys = await prepareExecution(directory, state);
  assert.ok(keys);
  assert.notEqual(keys.hostKey, keys.clientKey);
  assert.match(
    keys.knownHosts,
    /^\[runtime\.clawscarf\.internal\]:2222,\[127\.0\.0\.1\]:17218 ssh-ed25519 /,
  );
  assert.deepEqual(await prepareExecution(directory, state), keys);
  const workerHome = join(directory, "worker");
  const workerInput = {
    ownerId: state.ownerId,
    hostKey: keys.hostKey,
    authorizedKey: keys.authorizedKey,
  };
  await initializeWorkerHome(workerHome, workerInput, uid, gid);
  await writeFile(join(workerHome, "retained.txt"), "team data");
  await initializeWorkerHome(workerHome, workerInput, uid, gid);
  for (const path of [workerHome, join(workerHome, ".clawscarf-worker")]) {
    const originalMode = (await lstat(path)).mode & 0o777;
    await chmod(path, 0o777);
    await assert.rejects(
      initializeWorkerHome(workerHome, workerInput, uid, gid),
      /original ownership and safe permissions/,
    );
    assert.equal((await lstat(path)).mode & 0o777, 0o777);
    await chmod(path, originalMode);
  }
  await assert.rejects(
    initializeWorkerHome(workerHome, workerInput, uid + 1, gid),
    /original ownership and safe permissions/,
  );
  await initializeWorkerHome(workerHome, workerInput, uid, gid);
  assert.equal(
    await readFile(join(workerHome, "retained.txt"), "utf8"),
    "team data",
  );
  await assert.rejects(
    initializeWorkerHome(
      workerHome,
      { ...workerInput, ownerId: "00000000-0000-4000-8000-000000000002" },
      uid,
      gid,
    ),
  );
  assert.equal(
    await readFile(join(workerHome, ".clawscarf-worker/host_ed25519"), "utf8"),
    keys.hostKey,
  );
  await assert.rejects(lstat(join(workerHome, ".openclaw")), {
    code: "ENOENT",
  });
  const gatewayHome = join(directory, "gateway");
  await initializeHome(
    gatewayHome,
    {
      ownerId: state.ownerId,
      serverId: "00000000-0000-4000-8000-000000000003",
      configuration: "{}",
      executionCredential: {
        clientKey: keys.clientKey,
        knownHosts: keys.knownHosts,
      },
    },
    uid,
    gid,
  );
  const clientPath = join(
    gatewayHome,
    ".openclaw/clawscarf-execution/client_ed25519",
  );
  assert.equal(await readFile(clientPath, "utf8"), keys.clientKey);
  assert.equal((await lstat(clientPath)).mode & 0o777, 0o600);
  await assert.rejects(
    lstat(join(gatewayHome, ".openclaw/clawscarf-execution/host_ed25519")),
    { code: "ENOENT" },
  );
  const keyPath = join(directory, "private/execution/client_ed25519");
  await chmod(keyPath, 0o644);
  await assert.rejects(prepareExecution(directory, state));
  await chmod(keyPath, 0o600);
  await writeFile(keyPath + ".pub", "ssh-ed25519 AAAA\n");
  await assert.rejects(prepareExecution(directory, state));
  assert.equal(await readFile(keyPath, "utf8"), keys.clientKey);
});

await test("worker bootstrap refuses unowned data and incomplete credentials without deleting them", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-unowned-worker-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "customer.txt"), "keep");
  const value = {
    ownerId: state.ownerId,
    hostKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture",
    authorizedKey: "ssh-ed25519 AAAA\n",
  };
  await assert.rejects(initializeWorkerHome(home, value, uid, gid));
  assert.equal(await readFile(join(home, "customer.txt"), "utf8"), "keep");
  await mkdir(join(home, ".clawscarf-worker"), { mode: 0o700 });
  await assert.rejects(initializeWorkerHome(home, value, uid, gid));
  await assert.rejects(lstat(join(home, ".clawscarf-worker/host_ed25519")), {
    code: "ENOENT",
  });
});

await test("fresh worker homes receive private permissions and symbolic-link homes are never adopted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-worker-fresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = {
    ownerId: state.ownerId,
    hostKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture",
    authorizedKey: "ssh-ed25519 AAAA\n",
  };
  const home = join(root, "home");
  await mkdir(home);
  await chmod(home, 0o777);
  await initializeWorkerHome(home, value, uid, gid);
  assert.equal((await lstat(home)).mode & 0o777, 0o700);
  await initializeWorkerHome(home, value, uid, gid);
  await chmod(home, 0o777);
  await assert.rejects(
    initializeWorkerHome(home, value, uid, gid),
    /original ownership and safe permissions/,
  );
  assert.equal((await lstat(home)).mode & 0o777, 0o777);

  const outside = join(root, "outside"),
    linked = join(root, "linked");
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, linked);
  await assert.rejects(
    initializeWorkerHome(linked, value, uid, gid),
    /not a symbolic link/,
  );
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  await assert.rejects(lstat(join(outside, ".clawscarf-worker")), {
    code: "ENOENT",
  });
});

await test("execution is explicit, has a distinct listener and grants only SSH to that worker", async () => {
  for (const execution of [
    { ...input.execution, image: "worker:latest" },
    { ...input.execution, port: input.ports.controller },
    { ...input.execution, cpu: "0" },
    { ...input.execution, memory: "0Gi" },
  ])
    assert.throws(() => parseLocalInput({ ...input, execution }));
  const without = {
    ...state,
    input: parseLocalInput({
      ...input,
      execution: undefined,
      relayImage: undefined,
    }),
  };
  assert.equal(await prepareExecution("/does-not-exist", without), undefined);
  const policy = initialRuntimePolicy(
    await readFile(
      new URL("../../deploy/openshell/policy.yaml", import.meta.url),
      "utf8",
    ),
    undefined,
    input.execution,
  );
  assert.deepEqual(policy.network_policies, {
    execution_worker: {
      name: "Execution worker",
      endpoints: [
        { host: "runtime.clawscarf.internal", port: 2222, protocol: "tcp" },
      ],
      binaries: [{ path: "/usr/bin/ssh" }],
    },
  });
  const config = executionDefaults();
  assert.equal(config.ssh.strictHostKeyChecking, true);
  assert.equal(config.ssh.updateHostKeys, false);
  assert.equal(config.backend, "ssh");
  assert.equal(config.ssh.target, "node@runtime.clawscarf.internal:2222");
});

await test("worker-only setup exposes no browser listener and binds the relay only to its runtime network", () => {
  const compose = composeConfiguration(
    state,
    "/private/execution-test",
    undefined,
    "10.76.2.30",
  );
  const relay = compose.services["execution-relay"];
  assert.ok(relay);
  assert.deepEqual(Object.keys(relay.networks), ["runtime"]);
  assert.equal("ports" in relay, false);
  assert.equal("browser" in compose.services, false);
  assert.equal("browser-egress" in compose.services, false);
  assert.deepEqual(relay.networks.runtime, {
    ipv4_address: "10.76.2.30",
    aliases: ["runtime.clawscarf.internal"],
  });
  assert.throws(() => composeConfiguration(state, "/private/execution-test"));
});
