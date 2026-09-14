import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { CommonError } from "../shared/errors.js";
import type { ConnectorJson } from "../types/catalog.js";
import type { ConnectionProtection } from "../types/ports.js";
import {
  requireConnectorJson,
  canonicalConnectorJson,
} from "../types/validation.js";

/** Authenticated storage and domain-separated keys adapt the native command protection owner. */
export class EncryptedConnectionProtection implements ConnectionProtection {
  private readonly encryptionKey: Buffer;
  private readonly fingerprintKey: Buffer;
  constructor(
    key: Buffer,
    private readonly deploymentId: string,
  ) {
    if (key.length !== 32 || !/^[a-zA-Z0-9_-]{1,100}$/.test(deploymentId))
      throw Error("Invalid connection protection configuration.");
    this.encryptionKey = Buffer.from(
      hkdfSync("sha256", key, "clawscarf", "connections-encryption-v1", 32),
    );
    this.fingerprintKey = Buffer.from(
      hkdfSync("sha256", key, "clawscarf", "connections-fingerprint-v1", 32),
    );
  }
  issueCredential() {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hashCredential(token) };
  }
  hashCredential(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new CommonError(
        "unauthenticated",
        "Installation credential is invalid.",
      );
    return createHash("sha256").update(token).digest("hex");
  }
  subject(userId: string) {
    return (
      "clawscarf_" +
      createHash("sha256")
        .update(this.deploymentId)
        .update("\0")
        .update(userId)
        .digest("hex")
    );
  }
  seal(binding: string, value: ConnectorJson) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(binding));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }
  open(binding: string, value: string) {
    const packed = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      packed.subarray(0, 12),
      { authTagLength: 16 },
    );
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(packed.subarray(12, 28));
    const data: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    return requireConnectorJson(data, 8 * 1024 * 1024);
  }
  fingerprint(binding: string, value: ConnectorJson) {
    return createHmac("sha256", this.fingerprintKey)
      .update(binding)
      .update("\0")
      .update(canonicalConnectorJson(value))
      .digest("hex");
  }
}
