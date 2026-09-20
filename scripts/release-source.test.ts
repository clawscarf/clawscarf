import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareOpenClaw } from "./openclaw/patches.js";
import { verifyOpenClawSource } from "./release/openclaw-source.js";

await test("candidate packaging verifies the exact source offer from image builds", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-source-offer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upstream = join(root, "upstream");
  const patches = join(root, "runtime/openclaw/patches");
  const archivedPatches = join(root, "archived-patches");
  await mkdir(upstream);
  await mkdir(patches, { recursive: true });
  await mkdir(join(root, "release"));
  const git = (args: string[]) =>
    execFileSync("git", ["-C", upstream, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trimEnd();
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Patch test"]);
  git(["config", "user.email", "patch@example.invalid"]);
  await writeFile(join(upstream, "source.txt"), "upstream\n");
  git(["add", "."]);
  git(["commit", "-m", "Upstream fixture"]);
  const upstreamRevision = git(["rev-parse", "HEAD"]);
  await writeFile(join(upstream, "source.txt"), "distribution\n");
  git(["commit", "-am", "Change fixture\n\nClawScarf-Patch: example-change"]);
  await writeFile(
    join(patches, "example-change.patch"),
    git(["format-patch", "--stdout", "-1", "--no-signature"]) + "\n",
  );
  await writeFile(
    join(patches, "example-change.prompt.md"),
    "Required behavior.\n",
  );
  await writeFile(join(patches, "series"), "example-change.patch\n");
  await writeFile(
    join(root, "release/components.json"),
    JSON.stringify({
      openclaw: {
        sourceRevision: upstreamRevision,
        sourceTree: git(["rev-parse", "HEAD^{tree}"]),
      },
    }),
  );
  const provenance = await prepareOpenClaw(
    root,
    join(root, "prepared"),
    upstream,
  );
  const sourceFile = join(root, "openclaw-source.json");
  const archive = join(root, "openclaw-patches.tgz");
  const pack = () =>
    execFileSync("tar", ["-czf", archive, "-C", archivedPatches, "."]);
  await writeFile(sourceFile, JSON.stringify(provenance));
  await cp(patches, archivedPatches, { recursive: true });
  pack();
  await verifyOpenClawSource(root, sourceFile, archive);

  await t.test("rejects a stale patched source tree", async () => {
    await writeFile(
      sourceFile,
      JSON.stringify({ ...provenance, tree: "0".repeat(40) }),
    );
    await assert.rejects(
      verifyOpenClawSource(root, sourceFile, archive),
      /provenance does not match/,
    );
    await writeFile(sourceFile, JSON.stringify(provenance));
  });
  for (const file of [
    "series",
    "example-change.patch",
    "example-change.prompt.md",
  ]) {
    await t.test(
      `rejects changed ${file} bytes in the release archive`,
      async () => {
        await writeFile(join(archivedPatches, file), "tampered\n");
        pack();
        await assert.rejects(
          verifyOpenClawSource(root, sourceFile, archive),
          /source archive checksum mismatch/,
        );
        await writeFile(
          join(archivedPatches, file),
          await readFile(join(patches, file)),
        );
      },
    );
  }
  await t.test(
    "rejects extra files rather than shipping unreviewed source",
    async () => {
      await writeFile(
        join(archivedPatches, "unreviewed.patch"),
        "unexpected\n",
      );
      pack();
      await assert.rejects(
        verifyOpenClawSource(root, sourceFile, archive),
        /does not contain the exact patch series/,
      );
    },
  );
});
