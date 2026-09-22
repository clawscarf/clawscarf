import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { acquireRuntimeTools, retainRuntime } from "./installation/runtime.js";
import { fingerprint, verifyReleaseTool } from "./installation/files.js";
import { releaseSchema, hostPlatformSchema } from "./release/definition.js";

await test("retained runtime survives removal of its package; downloads are verified before use", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = "#!/bin/sh\nexit 0\n";
  const source = join(root, "release.json");
  const release = releaseSchema.parse(
    JSON.parse(await readFile(resolve("runtime/current.json"), "utf8")),
  );
  const host = hostPlatformSchema.parse(`${process.platform}-${process.arch}`);
  release.platforms = [host];
  for (const name of ["cli", "gateway"] as const)
    release.tools.openshell[name] = {
      [host]: {
        file: `absent-${name}`,
        sha256: fingerprint(executable),
        url: `https://example.test/${name}`,
      },
    };
  await writeFile(source, JSON.stringify(release));
  const installation = join(root, "installation");
  const retained = resolve(
    installation,
    await retainRuntime(source, installation),
  );
  await writeFile(source, JSON.stringify({ ...release, version: "99.0.0" }));
  assert.equal(
    releaseSchema.parse(JSON.parse(await readFile(retained, "utf8"))).version,
    release.version,
  );
  await rm(source);
  let calls = 0;
  class Download extends Response {
    override get url() {
      return "https://example.test/tool";
    }
  }
  const network = t.mock.method(globalThis, "fetch", () => {
    calls++;
    return Promise.resolve(new Download(executable));
  });
  await assert.rejects(acquireRuntimeTools(retained, {}), /Run configure/);
  assert.equal(calls, 0);
  await acquireRuntimeTools(retained, { acquire: true });
  assert.equal(calls, 2);
  await acquireRuntimeTools(retained, { acquire: true });
  assert.equal(
    calls,
    2,
    "restart/configure does not redownload installed tools",
  );
  const file = join(dirname(retained), "tools/openshell");
  await verifyReleaseTool(file, fingerprint(executable));
  await writeFile(file, "modified");
  await assert.rejects(
    acquireRuntimeTools(retained, { acquire: true }),
    /checksum/,
  );
  assert.equal(calls, 2, "corrupted tools are not silently overwritten");
  await rm(file);
  network.mock.mockImplementation(() =>
    Promise.resolve(new Download("incorrect download")),
  );
  await assert.rejects(
    acquireRuntimeTools(retained, { acquire: true }),
    /checksum/,
  );
  assert.deepEqual(
    await readdir(dirname(file)),
    ["openshell-gateway"],
    "failed download leaves no executable or partial file",
  );
  assert.throws(() =>
    releaseSchema.parse({
      ...release,
      tools: {
        openshell: {
          ...release.tools.openshell,
          cli: {
            [host]: {
              ...release.tools.openshell.cli[host],
              url: "http://example.test/tool",
            },
          },
        },
      },
    }),
  );
});
