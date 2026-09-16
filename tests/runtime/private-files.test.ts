import assert from "node:assert/strict";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isMissingFile,
  privateDirectory,
  readPrivateFile,
} from "../../runtime/private-files.js";

await test("private file readers share bounded descriptor and ownership checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-private-files-"));
  const path = join(directory, "secret");
  try {
    await writeFile(path, "secret", { mode: 0o600 });
    assert.equal((await readPrivateFile(path, 6)).toString(), "secret");
    await assert.rejects(readPrivateFile(path, 5));
    await assert.rejects(
      readPrivateFile(path, 6, { uid: (process.getuid?.() ?? 0) + 1 }),
    );
    await chmod(path, 0o644);
    await assert.rejects(readPrivateFile(path));
    await chmod(path, 0o600);
    const other = join(directory, "link");
    await link(path, other);
    await assert.rejects(readPrivateFile(path));
    await rm(other);
    await symlink(path, other);
    await assert.rejects(readPrivateFile(other));
    await assert.rejects(readPrivateFile(directory));
    await privateDirectory(directory);
    await assert.rejects(privateDirectory(other));
    await chmod(directory, 0o755);
    await assert.rejects(privateDirectory(directory));
    await chmod(directory, 0o700);
    const missing = join(directory, "missing");
    await assert.rejects(
      readPrivateFile(missing),
      (error: unknown) =>
        isMissingFile(error, missing) && !isMissingFile(error, path),
    );
    await mkdir(missing);
    await assert.rejects(
      readPrivateFile(missing),
      (error: unknown) => !isMissingFile(error, missing),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
