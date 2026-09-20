import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateSourceProvenance } from "../openclaw/patches.js";

/** Verify that the image build's source offer matches this candidate's patch inputs. */
export async function verifyOpenClawSource(
  root: string,
  provenanceFile: string,
  patchesFile: string,
): Promise<void> {
  const provenance = await validateSourceProvenance(
    root,
    JSON.parse(await readFile(provenanceFile, "utf8")),
  );
  const archive = resolve(patchesFile);
  const expected = new Map<string, string>();
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  expected.set(
    "./series",
    hash(await readFile(join(root, "runtime/openclaw/patches/series"))),
  );
  for (const patch of provenance.patches) {
    expected.set(`./${patch.id}.patch`, patch.sha256);
    expected.set(`./${patch.id}.prompt.md`, patch.intentSha256);
  }
  const entries = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
    .trimEnd()
    .split("\n")
    .sort();
  const names = ["./", ...expected.keys()].sort();
  if (JSON.stringify(entries) !== JSON.stringify(names)) {
    throw Error(
      "OpenClaw source archive does not contain the exact patch series.",
    );
  }
  for (const [name, checksum] of expected) {
    const bytes = execFileSync("tar", ["-xOzf", archive, "--", name], {
      maxBuffer: 32 * 1024 * 1024,
    });
    if (hash(bytes) !== checksum) {
      throw Error(`OpenClaw source archive checksum mismatch: ${name}.`);
    }
  }
}
