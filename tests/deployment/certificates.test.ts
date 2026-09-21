import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { ensureCertificates } from "../../scripts/deployment/certificates.js";
import { ensurePrivateFile } from "../../scripts/deployment/state.js";

await test("local TLS supports host forwarding, preserves keys and rejects incomplete state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-tls-"));
  try {
    await ensureCertificates(directory);
    const path = join(directory, "management-key.pem");
    const key = await readFile(path);
    const cert = new X509Certificate(
      await readFile(join(directory, "management-cert.pem")),
    );
    assert.equal(
      cert.checkHost("host.docker.internal"),
      "host.docker.internal",
    );
    assert.equal(cert.ca, true);
    assert.equal(cert.checkHost("companion"), "companion");
    assert.equal(cert.verify(cert.publicKey), true);
    await ensureCertificates(directory);
    assert.deepEqual(await readFile(path), key);
    await rm(join(directory, "management-ca.pem"));
    await assert.rejects(ensureCertificates(directory), {
      code: "incomplete_certificate",
    });
    assert.deepEqual(await readFile(path), key);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
await test("setup configuration does not overwrite a deliberate edit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-config-"));
  try {
    const path = join(directory, "access.json");
    await ensurePrivateFile(path, "initial");
    await ensurePrivateFile(path, "initial");
    await writeFile(path, "edited");
    await assert.rejects(ensurePrivateFile(path, "initial"), {
      code: "configuration_changed",
    });
    assert.equal(await readFile(path, "utf8"), "edited");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
