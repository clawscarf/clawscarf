import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  exportOpenClaw,
  prepareOpenClaw,
  validateSourceProvenance,
  verifyOpenClaw,
} from "./openclaw/patches.js";

function git(directory: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-C",
      directory,
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
      },
    },
  ).trimEnd();
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-patches-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const patches = join(root, "runtime/openclaw/patches");
  await mkdir(source);
  await mkdir(patches, { recursive: true });
  await mkdir(join(root, "release"));
  git(source, "init", "-b", "fixture");
  await writeFile(join(source, "feature.txt"), "base\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "Upstream");
  const base = git(source, "rev-parse", "HEAD");
  await writeFile(join(source, "feature.txt"), "base\nfeature\n");
  git(source, "commit", "-am", "Add feature\n\nClawScarf-Patch: feature");
  await writeFile(join(source, "feature.txt"), "base\nconfigured-feature\n");
  git(
    source,
    "commit",
    "-am",
    "Configure feature\n\nClawScarf-Patch: configure-feature",
  );
  const tree = git(source, "rev-parse", "HEAD^{tree}");
  await writeFile(
    join(root, "release/components.json"),
    JSON.stringify({
      openclaw: { sourceRevision: base, sourceTree: tree },
      untouched: true,
    }),
  );
  await writeFile(
    join(patches, "series"),
    "feature.patch\nconfigure-feature.patch\n",
  );
  for (const id of ["feature", "configure-feature"])
    await writeFile(
      join(patches, `${id}.prompt.md`),
      `Preserve ${id} behavior and tests.\n`,
    );
  await exportOpenClaw(root, source);
  return { root, source, patches, base, tree };
}

await test("export, prepare and verify reconstruct the exact source and retain unrelated pins", async (t) => {
  const f = await fixture(t);
  const original = await readFile(join(f.patches, "feature.patch"), "utf8");
  const directory = join(f.root, "prepared");
  const provenance = await prepareOpenClaw(f.root, directory, f.source);
  assert.equal(provenance.tree, f.tree);
  assert.equal(
    await readFile(join(directory, "feature.txt"), "utf8"),
    "base\nconfigured-feature\n",
  );
  await exportOpenClaw(f.root, directory);
  assert.equal(
    await readFile(join(f.patches, "feature.patch"), "utf8"),
    original,
  );
  assert.equal(
    (
      JSON.parse(
        await readFile(join(f.root, "release/components.json"), "utf8"),
      ) as { untouched: boolean }
    ).untouched,
    true,
  );
  assert.deepEqual(await verifyOpenClaw(f.root, f.source), provenance);
  assert.deepEqual(
    await validateSourceProvenance(f.root, provenance),
    provenance,
  );
  await assert.rejects(
    validateSourceProvenance(f.root, {
      ...provenance,
      patchSetSha256: "0".repeat(64),
    }),
    /provenance/,
  );
});

await test("editing an early patch and replaying its dependent patch updates saved source", async (t) => {
  const f = await fixture(t);
  const later = git(f.source, "rev-parse", "HEAD");
  git(f.source, "reset", "--hard", "HEAD~1");
  await writeFile(join(f.source, "feature-doc.txt"), "Feature instructions\n");
  git(f.source, "add", ".");
  git(f.source, "commit", "--amend", "--no-edit");
  git(f.source, "cherry-pick", later);
  const result = await exportOpenClaw(f.root, f.source);
  assert.notEqual(result.tree, f.tree);
  const destination = join(f.root, "edited");
  await prepareOpenClaw(f.root, destination, f.source);
  assert.equal(
    await readFile(join(destination, "feature-doc.txt"), "utf8"),
    "Feature instructions\n",
  );
  assert.equal(
    await readFile(join(destination, "feature.txt"), "utf8"),
    "base\nconfigured-feature\n",
  );
});

await test("export rejects incomplete stacks and uncommitted or untracked work without modifying patches", async (t) => {
  const f = await fixture(t);
  const original = await readFile(join(f.patches, "feature.patch"), "utf8");
  await writeFile(join(f.source, "unsaved.txt"), "new source\n");
  await assert.rejects(exportOpenClaw(f.root, f.source), /must be clean/);
  await rm(join(f.source, "unsaved.txt"));
  await writeFile(join(f.source, "feature.txt"), "unsaved\n");
  await assert.rejects(exportOpenClaw(f.root, f.source), /must be clean/);
  git(f.source, "reset", "--hard", "HEAD~1");
  await assert.rejects(
    exportOpenClaw(f.root, f.source),
    /complete patch series/,
  );
  assert.equal(
    await readFile(join(f.patches, "feature.patch"), "utf8"),
    original,
  );
});

await test("reordered dependent patches stop instead of being skipped, with no success provenance", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.patches, "series"),
    "configure-feature.patch\nfeature.patch\n",
  );
  await assert.rejects(
    prepareOpenClaw(f.root, join(f.root, "conflicted"), f.source),
    /Cannot apply configure-feature/,
  );
  await assert.rejects(
    exportOpenClaw(f.root, f.source),
    /must identify patch configure-feature/,
  );
});

await test("stale tree pin and modified patch bytes fail reconstruction", async (t) => {
  const f = await fixture(t);
  const pin = join(f.root, "release/components.json");
  await writeFile(
    pin,
    JSON.stringify({
      openclaw: { sourceRevision: f.base, sourceTree: "0".repeat(40) },
    }),
  );
  await assert.rejects(verifyOpenClaw(f.root, f.source), /differs from pinned/);
  await writeFile(
    pin,
    JSON.stringify({
      openclaw: { sourceRevision: f.base, sourceTree: f.tree },
    }),
  );
  const file = join(f.patches, "configure-feature.patch");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "+configured-feature",
      "+different-feature",
    ),
  );
  await assert.rejects(verifyOpenClaw(f.root, f.source), /differs from pinned/);
});

await test("source provenance is independent of inherited Git identity and configuration", async (t) => {
  const f = await fixture(t);
  const original = await verifyOpenClaw(f.root, f.source);
  const overrides = {
    GIT_COMMITTER_NAME: "Different host",
    GIT_COMMITTER_EMAIL: "different@example.test",
    GIT_AUTHOR_NAME: "Wrong author",
    GIT_AUTHOR_EMAIL: "wrong@example.test",
    GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2002-01-01T00:00:00Z",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "format.subjectPrefix",
    GIT_CONFIG_VALUE_0: "CUSTOM",
  };
  const previous = new Map(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, overrides);
    assert.deepEqual(await verifyOpenClaw(f.root, f.source), original);
    const bytes = await readFile(join(f.patches, "feature.patch"), "utf8");
    await exportOpenClaw(f.root, f.source);
    assert.equal(
      await readFile(join(f.patches, "feature.patch"), "utf8"),
      bytes,
    );
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
});

await test("series inventory requires exact names, unique entries, and paired intent files", async (t) => {
  const f = await fixture(t);
  const series = join(f.patches, "series");
  await writeFile(series, "../escape.patch\n");
  await assert.rejects(
    verifyOpenClaw(f.root, f.source),
    /Invalid patch filename/,
  );
  await writeFile(series, "feature.patch\nfeature.patch\n");
  await assert.rejects(verifyOpenClaw(f.root, f.source), /Duplicate patch/);
  await writeFile(series, "feature.patch\nconfigure-feature.patch\n");
  await writeFile(join(f.patches, "unlisted.patch"), "orphan");
  await assert.rejects(
    verifyOpenClaw(f.root, f.source),
    /Unlisted patch input/,
  );
  await rm(join(f.patches, "unlisted.patch"));
  await rm(join(f.patches, "feature.prompt.md"));
  await assert.rejects(verifyOpenClaw(f.root, f.source), /ENOENT/);
});

await test("prepare refuses to reuse a checkout containing user work", async (t) => {
  const f = await fixture(t);
  const before = git(f.source, "rev-parse", "HEAD");
  await assert.rejects(prepareOpenClaw(f.root, f.source, f.source), /EEXIST/);
  assert.equal(git(f.source, "rev-parse", "HEAD"), before);
});
