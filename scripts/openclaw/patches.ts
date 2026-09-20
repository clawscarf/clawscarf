import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const patchIdentity = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const patchInfoSchema = z.strictObject({
  id: z.string().regex(patchIdentity),
  sha256: digestSchema,
  intentSha256: digestSchema,
});
export const sourceProvenanceSchema = z.strictObject({
  upstreamRevision: revisionSchema,
  revision: revisionSchema,
  tree: revisionSchema,
  patchSetSha256: digestSchema,
  patches: z.array(patchInfoSchema),
});
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;

const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const patchDirectory = (root: string) => join(root, "runtime/openclaw/patches");

function gitEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitOutput(directory: string, args: string[], input?: string): string {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      "-C",
      directory,
      ...args,
    ],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      ...(input === undefined ? {} : { input }),
      env: gitEnvironment(),
    },
  );
}

const git = (directory: string, args: string[], input?: string) =>
  gitOutput(directory, args, input).trimEnd();

async function regularFile(file: string): Promise<string> {
  if (!(await lstat(file)).isFile())
    throw Error(`Expected a regular file: ${file}`);
  return readFile(file, "utf8");
}

async function readInputs(root: string, allowMissingPatches = false) {
  const pinsPath = join(root, "release/components.json");
  const pins = z
    .object({
      openclaw: z.object({
        sourceRevision: revisionSchema,
        sourceTree: revisionSchema,
      }),
    })
    .parse(JSON.parse(await regularFile(pinsPath)));
  const directory = patchDirectory(root);
  const series = await regularFile(join(directory, "series"));
  const names = series
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!names.length) throw Error("The OpenClaw patch series is empty.");
  const ids = names.map((name) => {
    const id = name.replace(/\.patch$/, "");
    if (!name.endsWith(".patch") || !patchIdentity.test(id))
      throw Error(`Invalid patch filename: ${name}`);
    return id;
  });
  if (new Set(ids).size !== ids.length)
    throw Error("Duplicate patch in series.");
  const expected = new Set([
    "series",
    ...ids.flatMap((id) => [`${id}.patch`, `${id}.prompt.md`]),
  ]);
  for (const name of await readdir(directory)) {
    if (!expected.has(name)) throw Error(`Unlisted patch input: ${name}`);
  }
  const patches = [];
  for (const id of ids) {
    const intent = await regularFile(join(directory, `${id}.prompt.md`));
    if (!intent.trim()) throw Error(`Missing patch intent: ${id}`);
    let text = "";
    try {
      text = await regularFile(join(directory, `${id}.patch`));
    } catch (error) {
      if (
        !allowMissingPatches ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    patches.push({
      id,
      text,
      intent,
      sha256: hash(text),
      intentSha256: hash(intent),
    });
  }
  const metadata = patches.map(({ id, sha256, intentSha256 }) => ({
    id,
    sha256,
    intentSha256,
  }));
  return {
    pinsPath,
    directory,
    series,
    patches,
    upstreamRevision: pins.openclaw.sourceRevision,
    tree: pins.openclaw.sourceTree,
    patchSetSha256: hash(
      JSON.stringify({
        upstreamRevision: pins.openclaw.sourceRevision,
        series,
        patches: metadata,
      }),
    ),
    metadata,
  };
}

export async function validateSourceProvenance(
  root: string,
  value: unknown,
): Promise<SourceProvenance> {
  const provenance = sourceProvenanceSchema.parse(value);
  const inputs = await readInputs(root);
  if (
    provenance.upstreamRevision !== inputs.upstreamRevision ||
    provenance.tree !== inputs.tree ||
    provenance.patchSetSha256 !== inputs.patchSetSha256 ||
    JSON.stringify(provenance.patches) !== JSON.stringify(inputs.metadata)
  ) {
    throw Error(
      "OpenClaw source provenance does not match the pinned patch series.",
    );
  }
  return provenance;
}

async function checkout(
  directory: string,
  upstreamRevision: string,
  source: string,
) {
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory); // Never reset or reuse an existing developer checkout.
  git(directory, ["init", "--initial-branch=clawscarf-patches"]);
  git(directory, ["remote", "add", "origin", source]);
  git(directory, ["fetch", "--depth=1", "origin", upstreamRevision]);
  git(directory, ["checkout", "-b", "codex/openclaw-patches", "FETCH_HEAD"]);
  if (git(directory, ["rev-parse", "HEAD"]) !== upstreamRevision)
    throw Error("Wrong OpenClaw upstream revision.");
}

function commitIds(directory: string, upstreamRevision: string, ids: string[]) {
  git(directory, ["merge-base", "--is-ancestor", upstreamRevision, "HEAD"]);
  const commits = git(directory, [
    "rev-list",
    "--reverse",
    `${upstreamRevision}..HEAD`,
  ])
    .split("\n")
    .filter(Boolean);
  if (commits.length !== ids.length)
    throw Error("Commit count does not match the complete patch series.");
  for (const [index, commit] of commits.entries()) {
    const id = ids[index];
    if (!id) throw Error("Missing patch identity.");
    if (
      git(directory, ["rev-list", "--parents", "-n", "1", commit]).split(" ")
        .length !== 2
    )
      throw Error(
        "Patch series must be linear; merge commits are unsupported.",
      );
    const message = git(directory, ["show", "-s", "--format=%B", commit]);
    const trailers = git(directory, ["interpret-trailers", "--parse"], message)
      .split("\n")
      .filter((line) => /^ClawScarf-Patch:/i.test(line));
    if (trailers.length !== 1 || trailers[0] !== `ClawScarf-Patch: ${id}`)
      throw Error(
        `Commit ${commit} must identify patch ${id} with one ClawScarf-Patch trailer, in series order.`,
      );
  }
  return commits;
}

function replay(
  directory: string,
  inputs: Awaited<ReturnType<typeof readInputs>>,
) {
  for (const patch of inputs.patches) {
    try {
      git(directory, [
        "-c",
        "user.name=ClawScarf Patch Builder",
        "-c",
        "user.email=patches@clawscarf.com",
        "am",
        "--committer-date-is-author-date",
        "--no-gpg-sign",
        "--whitespace=error-all",
        join(inputs.directory, `${patch.id}.patch`),
      ]);
    } catch (error) {
      throw new Error(
        `Cannot apply ${patch.id}. No patch was skipped; use prepare to retain a checkout for conflict diagnosis.`,
        { cause: error },
      );
    }
  }
  commitIds(
    directory,
    inputs.upstreamRevision,
    inputs.patches.map(({ id }) => id),
  );
}

export async function prepareOpenClaw(
  root: string,
  directory: string,
  source = "https://github.com/openclaw/openclaw.git",
): Promise<SourceProvenance> {
  const inputs = await readInputs(root);
  await checkout(resolve(directory), inputs.upstreamRevision, source);
  replay(resolve(directory), inputs);
  const tree = git(directory, ["rev-parse", "HEAD^{tree}"]);
  if (tree !== inputs.tree)
    throw Error(
      `Patched OpenClaw tree ${tree} differs from pinned ${inputs.tree}.`,
    );
  return {
    upstreamRevision: inputs.upstreamRevision,
    revision: git(directory, ["rev-parse", "HEAD"]),
    tree,
    patchSetSha256: inputs.patchSetSha256,
    patches: inputs.metadata,
  };
}

function assertExportable(directory: string) {
  if (git(directory, ["status", "--porcelain", "--untracked-files=all"]))
    throw Error(
      "Commit or refresh all source changes before exporting; checkout must be clean.",
    );
  const branch = git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const stack = git(directory, [
    "for-each-ref",
    "--format=%(refname)",
    `refs/stacks/${branch}`,
  ]);
  if (stack) {
    const series = (args: string[]) =>
      execFileSync("stg", ["-C", directory, "series", "--noprefix", ...args], {
        encoding: "utf8",
        env: gitEnvironment(),
      }).trim();
    if (series(["--all"]) !== series(["--applied"]))
      throw Error(
        "Apply every StGit patch before export, including hidden patches.",
      );
  }
}

/** Export only after a fresh replay proves that every source edit was captured. */
export async function exportOpenClaw(root: string, directory: string) {
  directory = resolve(directory);
  assertExportable(directory);
  const inputs = await readInputs(root, true);
  const commits = commitIds(
    directory,
    inputs.upstreamRevision,
    inputs.patches.map(({ id }) => id),
  );
  const temporary = await mkdtemp(join(tmpdir(), "clawscarf-patch-export-"));
  try {
    const staged = join(temporary, "patches");
    await mkdir(staged);
    const patches = [];
    for (const [index, patch] of inputs.patches.entries()) {
      const commit = commits[index];
      if (!commit) throw Error("Missing patch commit.");
      const text = gitOutput(directory, [
        "-c",
        "format.useAutoBase=false",
        "format-patch",
        "--subject-prefix=PATCH",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--zero-commit",
        "--no-signature",
        "--no-numbered",
        "--full-index",
        "--binary",
        "-1",
        "--stdout",
        commit,
      ]);
      await writeFile(join(staged, `${patch.id}.patch`), text);
      patches.push({ ...patch, text });
    }
    const check = join(temporary, "checkout");
    await checkout(check, inputs.upstreamRevision, directory);
    replay(check, { ...inputs, directory: staged, patches });
    const tree = git(directory, ["rev-parse", "HEAD^{tree}"]);
    if (git(check, ["rev-parse", "HEAD^{tree}"]) !== tree)
      throw Error("Exported patches do not reproduce the development source.");
    // Each replacement is complete; interrupted multi-file updates fail the pinned-tree check.
    for (const patch of patches) {
      const target = join(inputs.directory, `${patch.id}.patch`);
      await writeFile(`${target}.tmp`, patch.text);
      await rename(`${target}.tmp`, target);
    }
    const pins: unknown = JSON.parse(await regularFile(inputs.pinsPath));
    const parsed = z
      .looseObject({ openclaw: z.looseObject({ sourceTree: z.string() }) })
      .parse(pins);
    parsed.openclaw.sourceTree = tree;
    await writeFile(
      `${inputs.pinsPath}.tmp`,
      JSON.stringify(parsed, null, 2) + "\n",
    );
    await rename(`${inputs.pinsPath}.tmp`, inputs.pinsPath);
    return { tree, patches: patches.map(({ id }) => id) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyOpenClaw(root: string, source?: string) {
  const temporary = await mkdtemp(join(tmpdir(), "clawscarf-patch-verify-"));
  try {
    return await prepareOpenClaw(root, join(temporary, "checkout"), source);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
