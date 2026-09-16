import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  lstat,
  readdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeHome } from "../../runtime/initialize.js";
await test("native volume initialization preserves edits and refuses foreign state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-home-"));
  try {
    const home = join(parent, "home");
    const value = {
      ownerId: "00000000-0000-4000-8000-000000000001",
      serverId: "00000000-0000-4000-8000-000000000002",
      configuration: "{}",
    };
    await initializeHome(
      home,
      value,
      process.getuid?.() ?? 1000,
      process.getgid?.() ?? 1000,
    );
    await writeFile(join(home, ".openclaw/openclaw.json"), "human edit");
    await initializeHome(
      home,
      value,
      process.getuid?.() ?? 1000,
      process.getgid?.() ?? 1000,
    );
    assert.equal(
      await readFile(join(home, ".openclaw/openclaw.json"), "utf8"),
      "human edit",
    );
    await assert.rejects(
      initializeHome(
        home,
        { ...value, ownerId: "00000000-0000-4000-8000-000000000003" },
        1000,
        1000,
      ),
    );
    const foreign = join(parent, "foreign");
    await mkdir(join(foreign, ".openclaw"), { recursive: true });
    await writeFile(join(foreign, ".openclaw/openclaw.json"), "{} ");
    await assert.rejects(initializeHome(foreign, value, 1000, 1000));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

const initial = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  serverId: "00000000-0000-4000-8000-000000000002",
  configuration: "{}",
};
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

await test("Connections bootstrap writes only its scoped credential and never replaces native edits on resume", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-connection-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await initializeHome(
    home,
    {
      ...initial,
      connectionsCredential: { token: "scoped-token", ca: "public CA" },
    },
    uid,
    gid,
  );
  const path = join(home, ".openclaw/clawscarf-connections/runtime.json");
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    token: "scoped-token",
  });
  await writeFile(path, JSON.stringify({ token: "user-rotated-token" }));
  await initializeHome(
    home,
    { ...initial, connectionsCredential: { token: "scoped-token" } },
    uid,
    gid,
  );
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    token: "user-rotated-token",
  });
});

await test("fresh pre-created volume home becomes private without changing retained home permissions", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-volume-permissions-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await chmod(home, 0o755);
  await initializeHome(home, initial, uid, gid);
  assert.equal((await lstat(home)).mode & 0o777, 0o700);
  await chmod(home, 0o750);
  await initializeHome(home, initial, uid, gid);
  assert.equal((await lstat(home)).mode & 0o777, 0o750);
});

await test("initial model credentials are private, owned and preserved with native edits on repeat preparation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-model-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const value = {
    ...initial,
    modelCredential: { token: "initial scoped key", ca: "initial public CA" },
  };
  await initializeHome(home, value, uid, gid);
  const directory = join(home, ".openclaw", "clawscarf-models");
  const credential = join(directory, "initial.json");
  const ca = join(directory, "ca.pem");
  assert.deepEqual(JSON.parse(await readFile(credential, "utf8")), {
    token: value.modelCredential.token,
  });
  assert.equal(await readFile(ca, "utf8"), value.modelCredential.ca);
  for (const [path, mode] of [
    [directory, 0o700],
    [credential, 0o600],
    [ca, 0o600],
  ] as const) {
    const metadata = await lstat(path);
    assert.equal(metadata.mode & 0o777, mode);
    assert.equal(metadata.uid, uid);
    assert.equal(metadata.gid, gid);
  }
  await writeFile(
    credential,
    JSON.stringify({ token: "operator replacement" }),
  );
  await writeFile(ca, "operator CA replacement");
  await writeFile(join(home, ".openclaw", "openclaw.json"), "native edit");
  for (const repeated of [
    initial,
    {
      ...value,
      modelCredential: { token: "new proposed key", ca: "new proposed CA" },
    },
  ])
    await initializeHome(home, repeated, uid, gid);
  await assert.rejects(
    initializeHome(
      home,
      { ...value, ownerId: "00000000-0000-4000-8000-000000000003" },
      uid,
      gid,
    ),
  );
  assert.deepEqual(JSON.parse(await readFile(credential, "utf8")), {
    token: "operator replacement",
  });
  assert.equal(await readFile(ca, "utf8"), "operator CA replacement");
  assert.equal(
    await readFile(join(home, ".openclaw", "openclaw.json"), "utf8"),
    "native edit",
  );
  await rm(credential);
  await initializeHome(home, value, uid, gid);
  await assert.rejects(lstat(credential), { code: "ENOENT" });
});

await test("optional credentials and CA are never installed later into an owned volume", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-optional-home-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const withoutModel = join(parent, "without-model");
  const withModel = join(parent, "with-model");
  await initializeHome(withoutModel, initial, uid, gid);
  await initializeHome(
    withoutModel,
    { ...initial, modelCredential: { token: "late key" } },
    uid,
    gid,
  );
  await assert.rejects(
    lstat(join(withoutModel, ".openclaw", "clawscarf-models")),
    { code: "ENOENT" },
  );
  await initializeHome(
    withModel,
    { ...initial, modelCredential: { token: "a".repeat(65536) } },
    uid,
    gid,
  );
  await initializeHome(
    withModel,
    { ...initial, modelCredential: { token: "late key", ca: "late CA" } },
    uid,
    gid,
  );
  await assert.rejects(
    lstat(join(withModel, ".openclaw", "clawscarf-models", "ca.pem")),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(withModel, ".openclaw", "clawscarf-models", "initial.json"),
        "utf8",
      ),
    ),
    { token: "a".repeat(65536) },
  );
});

await test("invalid model credential inputs cannot create native state or arbitrary files", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-invalid-model-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const modelCredential of [
    null,
    {},
    { token: "" },
    { token: " \n\t" },
    { token: 1 },
    { token: "a".repeat(65537) },
    { token: "scoped", ca: null },
    { token: "scoped", ca: 1 },
    { token: "scoped", path: "../outside" },
  ])
    await assert.rejects(
      initializeHome(home, { ...initial, modelCredential }, uid, gid),
    );
  assert.deepEqual(await readdir(home), []);
});

await test("a failed initial ownership change publishes neither configuration nor credentials", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-failed-model-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await assert.rejects(
    initializeHome(
      home,
      { ...initial, modelCredential: { token: "scoped", ca: "CA" } },
      Number.MAX_SAFE_INTEGER,
      gid,
    ),
  );
  assert.deepEqual(await readdir(home), []);
});
