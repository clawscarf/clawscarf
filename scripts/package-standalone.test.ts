import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { packageOperator } from "./release/operator.js";
import { packageStandalone } from "./release/standalone.js";

const execute = promisify(execFile);
await test(
  "standalone installation runs without system Node and rejects a damaged download",
  {
    skip: process.env.CLAWSCARF_TEST_STANDALONE_ARCHIVE !== "1",
    timeout: 300_000,
  },
  async (t) => {
    const root = process.cwd();
    const directory = await mkdtemp(
      join(tmpdir(), "clawscarf-standalone-test-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const archive = process.env.CLAWSCARF_STANDALONE_ARCHIVE
      ? resolve(process.env.CLAWSCARF_STANDALONE_ARCHIVE)
      : await packageStandalone(
          root,
          await packageOperator(root, join(directory, "npm")),
          join(directory, "built"),
        );
    const assets = join(directory, "assets");
    await mkdir(assets);
    const name = basename(archive);
    const version = /^clawscarf-(.+)-(?:darwin|linux)-(?:arm64|x64)\.tgz$/.exec(
      name,
    )?.[1];
    assert.ok(version);
    await copyFile(archive, join(assets, name));
    const sha = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    await writeFile(join(assets, "SHA256SUMS"), `${sha}  ${name}\n`);
    const installer = join(directory, "install.sh");
    await writeFile(
      installer,
      (await readFile(join(root, "release/install.sh"), "utf8")).replace(
        "@VERSION@",
        version,
      ),
    );
    const bin = join(directory, "bin");
    await mkdir(bin);
    // Only replace the network transport: install the real archive with the real shell/checksum tools.
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in https://*) url=$1 ;; -o) shift; destination=$1 ;; esac
  shift
done
file=$(basename "$url")
cp "$CLAWSCARF_TEST_ASSETS/$file" "$destination"
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, "node"),
      "#!/bin/sh\necho 'System Node must not be used' >&2\nexit 99\n",
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      CLAWSCARF_TEST_ASSETS: assets,
      CLAWSCARF_TELEMETRY_DISABLED: "1",
    };
    const prefix = join(directory, "installation with spaces");
    const installed = await execute(
      "/bin/sh",
      [installer, "--prefix", prefix],
      { env },
    );
    assert.match(installed.stdout, /Installed ClawScarf/);
    const command = join(prefix, "bin/clawscarf");
    assert.match(
      (await execute(command, ["--help"], { env, cwd: tmpdir() })).stdout,
      /Usage:/,
    );
    const recipes = await execute(command, ["recipes", "--json"], {
      env,
      cwd: tmpdir(),
    });
    assert.match(recipes.stdout, /team-server/);
    assert.ok(!recipes.stdout.includes(root));
    assert.match(
      await readFile(
        join(prefix, "lib/clawscarf", version, "node/LICENSE"),
        "utf8",
      ),
      /Permission is hereby granted/,
    );
    await writeFile(join(assets, name), "corrupted archive");
    const damaged = join(directory, "damaged");
    await assert.rejects(
      execute("/bin/sh", [installer, "--prefix", damaged], { env }),
    );
    await assert.rejects(readFile(join(damaged, "bin/clawscarf")), {
      code: "ENOENT",
    });
    assert.match(
      (await execute(command, ["--help"], { env })).stdout,
      /Usage:/,
    );
  },
);
