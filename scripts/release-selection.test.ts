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
