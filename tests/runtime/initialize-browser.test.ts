import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BrowserInitializationError,
  initializeBrowserState,
} from "../../runtime/initialize-browser.js";

async function fixture(
  run: (
    state: string,
    input: { ownerId: string; token: string },
    initialize: () => Promise<void>,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-browser-init-"));
  const state = join(directory, "state");
  const input = {
    ownerId: randomUUID(),
    token: randomBytes(32).toString("hex"),
  };
  const uid = process.getuid?.(),
    gid = process.getgid?.();
  assert.notEqual(uid, undefined);
  assert.notEqual(gid, undefined);
  assert.ok(typeof uid === "number" && typeof gid === "number");
  try {
    await run(state, input, () =>
      initializeBrowserState(state, input, uid, gid),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await test("browser initialization owns private identity and retains the existing profile", async () => {
  await fixture(async (state, input, initialize) => {
    await initialize();
    const target = join(state, ".clawscarf-browser");
    assert.deepEqual(
      JSON.parse(await readFile(join(target, "owner.json"), "utf8")),
      { ownerId: input.ownerId },
    );
    assert.equal(await readFile(join(target, "token"), "utf8"), input.token);
    for (const [path, mode] of [
      [state, 0o700],
      [target, 0o700],
      [join(target, "token"), 0o600],
      [join(target, "owner.json"), 0o600],
    ] as const) {
      const metadata = await lstat(path);
      assert.equal(metadata.mode & 0o777, mode);
      assert.equal(metadata.uid, process.getuid?.());
      assert.equal(metadata.gid, process.getgid?.());
    }
    await mkdir(join(state, "profile"));
    await writeFile(join(state, "profile", "session"), "retained");
    const before = await lstat(join(target, "token"));
    await initialize();
    assert.equal(
      await readFile(join(state, "profile", "session"), "utf8"),
      "retained",
    );
    assert.equal((await lstat(join(target, "token"))).mtimeMs, before.mtimeMs);
    assert.deepEqual((await readdir(state)).sort(), [
      ".clawscarf-browser",
      "profile",
    ]);
  });
});

await test("browser initialization rejects conflicting identity, token and malformed input", async () => {
  await fixture(async (state, input, initialize) => {
    await initialize();
    const uid = (await lstat(state)).uid,
      gid = (await lstat(state)).gid;
    for (const value of [
      { ...input, ownerId: randomUUID() },
      { ...input, token: randomBytes(32).toString("hex") },
    ])
      await assert.rejects(
        initializeBrowserState(state, value, uid, gid),
        BrowserInitializationError,
      );
    for (const value of [
      { ...input, extra: true },
      { ...input, token: "short" },
      { ...input, ownerId: "invalid" },
    ])
      await assert.rejects(initializeBrowserState(state, value, uid, gid));
    assert.equal(
      await readFile(join(state, ".clawscarf-browser", "token"), "utf8"),
      input.token,
    );
  });
});

await test("browser initialization refuses unowned data and symbolic links", async () => {
  await fixture(async (state, _input, initialize) => {
    await mkdir(state);
    await writeFile(join(state, "existing"), "untouched");
    await assert.rejects(initialize(), BrowserInitializationError);
    assert.equal(await readFile(join(state, "existing"), "utf8"), "untouched");
  });
  for (const selected of ["volume", "directory", "token", "owner.json"]) {
    await fixture(async (state, _input, initialize) => {
      const outside = `${state}-outside`;
      if (selected === "volume") {
        await mkdir(outside);
        await symlink(outside, state);
      } else {
        await initialize();
        const target =
          selected === "directory"
            ? join(state, ".clawscarf-browser")
            : join(state, ".clawscarf-browser", selected);
        if (selected === "directory") await mkdir(outside);
        else await writeFile(outside, "untouched");
        await rm(target, { recursive: true });
        await symlink(outside, target);
      }
      await assert.rejects(initialize(), BrowserInitializationError);
    });
  }
});

await test("browser resume refuses permissive credentials without repairing them silently", async () => {
  await fixture(async (state, _input, initialize) => {
    await initialize();
    const token = join(state, ".clawscarf-browser", "token");
    await chmod(token, 0o644);
    await assert.rejects(initialize(), BrowserInitializationError);
    assert.equal((await lstat(token)).mode & 0o777, 0o644);
  });
});
