import assert from "node:assert/strict";
import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { browserNodeConfiguration } from "../../deploy/execution/browser-node/configuration.js";
import { loadBrowserNodeInputs } from "../../deploy/execution/browser-node/start.js";

await test("browser node private inputs reject unsafe files without disclosing secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cs-browser-node-input-"));
  const configPath = join(directory, "openclaw.json"),
    pairingPath = join(directory, "pairing-code");
  const secret = "PRIVATE-CDP-PASSWORD-" + "s".repeat(40);
  const config = JSON.stringify(
    browserNodeConfiguration(`http://openclaw:${secret}@browser:9223`),
  );
  async function rejected() {
    await assert.rejects(
      loadBrowserNodeInputs(configPath, pairingPath),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!inspect(error).includes(secret));
        assert.ok(!inspect(error).includes("PRIVATE-PAIRING-CODE"));
        assert.equal("cause" in error, false);
        return true;
      },
    );
  }
  try {
    await writeFile(configPath, config, { mode: 0o600 });
    assert.deepEqual(await loadBrowserNodeInputs(configPath, pairingPath), {});
    await writeFile(pairingPath, "PRIVATE-PAIRING-CODE", { mode: 0o600 });
    assert.deepEqual(await loadBrowserNodeInputs(configPath, pairingPath), {
      pairingCode: "PRIVATE-PAIRING-CODE",
    });
    await writeFile(configPath, `{"private":"${secret}", broken`);
    await rejected();
    await writeFile(configPath, config);
    await chmod(configPath, 0o644);
    await rejected();
    await chmod(configPath, 0o600);
    await link(configPath, join(directory, "hardlink"));
    await rejected();
    await rm(join(directory, "hardlink"));
    await rm(configPath);
    await symlink(pairingPath, configPath);
    await rejected();
    await rm(configPath);
    await writeFile(configPath, "x".repeat(65537), { mode: 0o600 });
    await rejected();
    await writeFile(configPath, config);
    await writeFile(pairingPath, "PRIVATE-PAIRING-CODE".repeat(1000));
    await rejected();
    await rm(pairingPath);
    await symlink(configPath, pairingPath);
    await rejected();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
