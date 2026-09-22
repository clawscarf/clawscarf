import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import currentRuntime from "../runtime/current.json" with { type: "json" };
import { advanceRuntime } from "./release/advance-runtime.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-selection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previous = { ...currentRuntime, version: "1.0.0" };
  const next = { ...currentRuntime, version: "1.1.0" };
  const options = {
    current: join(directory, "current.json"),
    expected: join(directory, "expected.json"),
    candidate: join(directory, "candidate.json"),
  };
  await writeFile(options.current, JSON.stringify(previous));
  await writeFile(options.expected, JSON.stringify(previous));
  await writeFile(options.candidate, JSON.stringify(next, null, 2) + "\n");
  return { options, previous, next };
}

await test("published runtime promotion preserves the artifact and is safe to repeat", async (t) => {
  const { options } = await fixture(t);
  assert.equal(await advanceRuntime(options), true);
  assert.equal(
    await readFile(options.current, "utf8"),
    await readFile(options.candidate, "utf8"),
  );
  assert.equal(await advanceRuntime(options), false);
});

await test("stale release promotion cannot overwrite a concurrently changed runtime pin", async (t) => {
  const { options, previous } = await fixture(t);
  const changed = JSON.stringify({
    ...previous,
    sourceRevision: "f".repeat(40),
  });
  await writeFile(options.current, changed);
  await assert.rejects(advanceRuntime(options), /changed since/);
  assert.equal(await readFile(options.current, "utf8"), changed);
});

await test("runtime promotion rejects downgrades and same-version replacement", async (t) => {
  const { options, next } = await fixture(t);
  const before = await readFile(options.current, "utf8");
  for (const version of ["0.9.0", "1.0.0-beta.1", "1.0.0"]) {
    await writeFile(
      options.candidate,
      JSON.stringify({ ...next, version, sourceRevision: "e".repeat(40) }),
    );
    await assert.rejects(advanceRuntime(options), /newer release/);
    assert.equal(await readFile(options.current, "utf8"), before);
  }
});

await test("runtime promotion rejects manifests needing locally built images", async (t) => {
  const { options, next } = await fixture(t);
  const before = await readFile(options.current, "utf8");
  await writeFile(
    options.candidate,
    JSON.stringify({
      ...next,
      images: { ...next.images, gateway: `sha256:${"a".repeat(64)}` },
    }),
  );
  await assert.rejects(advanceRuntime(options), /registry digests/);
  assert.equal(await readFile(options.current, "utf8"), before);
});

await test("publication rejects stale inputs before registry access and safely recognizes an identical npm retry", async (t) => {
  const { checkPublication } = await import("./release/publication.js");
  const { createHash } = await import("node:crypto");
  const { options, previous, next } = await fixture(t);
  const tarball = join(options.current, "../cli.tgz");
  const bytes = Buffer.from("candidate npm payload");
  await writeFile(tarball, bytes);
  const input = { ...options, tarball };
  let channel = "1.0.0";
  let integrity: string | undefined = undefined;
  let calls = 0;
  const registry: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      Response.json({
        "dist-tags": { latest: channel },
        versions: integrity ? { [next.version]: { dist: { integrity } } } : {},
      }),
    );
  };
  await writeFile(
    options.current,
    JSON.stringify({ ...previous, version: "1.2.0" }),
  );
  await assert.rejects(checkPublication(input, registry), /changed since/);
  assert.equal(calls, 0);
  await writeFile(options.current, JSON.stringify(previous));
  channel = "1.2.0";
  await assert.rejects(checkPublication(input, registry), /newer version/);
  channel = "1.0.0";
  assert.equal(await checkPublication(input, registry), "publish");
  assert.deepEqual(
    JSON.parse(await readFile(options.current, "utf8")),
    previous,
  );
  channel = next.version;
  integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
  assert.equal(await checkPublication(input, registry), "already-published");
  await advanceRuntime(options);
  assert.equal(await checkPublication(input, registry), "already-published");
  await writeFile(tarball, "different payload");
  await assert.rejects(checkPublication(input, registry), /different bytes/);
  await assert.rejects(
    checkPublication(input, () =>
      Promise.resolve(new Response("", { status: 503 })),
    ),
    /registry check failed/,
  );
});
