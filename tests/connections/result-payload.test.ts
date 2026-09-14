import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { EncryptedConnectionProtection } from "../../services/connections/providers/protection.js";
import { sealInvocationPayload } from "../../services/connections/service/result-payload.js";

await test("maximum multibyte JSON fits UTF-8 pages without losing the final byte", () => {
  const protection = new EncryptedConnectionProtection(
    randomBytes(32),
    "test-results",
  );
  const value = "€".repeat((8 * 1024 * 1024 - 2) / 3);
  const expected = JSON.stringify(value);
  assert.equal(Buffer.byteLength(expected), 8 * 1024 * 1024);
  const sealed = sealInvocationPayload("invocation", value, protection);
  assert.equal(sealed.sealedResult, null);
  assert.ok(sealed.sealedResultManifest);
  assert.equal(sealed.pages.length, 1025);
  const parts: string[] = [];
  let offset = 0;
  for (const [index, encrypted] of sealed.pages.entries()) {
    const page = protection.open(`invocation:page:${index}`, encrypted);
    assert.ok(page && typeof page === "object" && !Array.isArray(page));
    assert.equal(page.offsetBytes, offset);
    assert.equal(typeof page.text, "string");
    assert.ok(typeof page.text === "string");
    const bytes = Buffer.byteLength(page.text);
    assert.ok(bytes > 0 && bytes <= 8192);
    offset += bytes;
    parts.push(page.text);
  }
  assert.equal(offset, 8 * 1024 * 1024);
  assert.equal(parts.join(""), expected);
});

await test("result encryption rejects substituted pages, keys, shortened tags and damaged ciphertext", () => {
  const protection = new EncryptedConnectionProtection(
    randomBytes(32),
    "test-results",
  );
  const other = new EncryptedConnectionProtection(
    randomBytes(32),
    "test-results",
  );
  const binding = "invocation:page:0";
  const data = { offsetBytes: 0, text: "private data" };
  const sealed = protection.seal(binding, data);
  assert.deepEqual(protection.open(binding, sealed), data);
  assert.throws(() => protection.open("invocation:page:1", sealed));
  assert.throws(() => protection.open("other:page:0", sealed));
  assert.throws(() => other.open(binding, sealed));
  const packed = Buffer.from(sealed, "base64");
  assert.throws(() =>
    protection.open(binding, packed.subarray(0, 24).toString("base64")),
  );
  packed[packed.length - 1] = packed[packed.length - 1]! ^ 1;
  assert.throws(() => protection.open(binding, packed.toString("base64")));
});
