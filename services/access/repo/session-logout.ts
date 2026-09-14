import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/** Logout hints can contain ID tokens. Bind encrypted storage to one browser session. */
export class SessionLogoutProtection {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    this.key = Buffer.from(
      hkdfSync("sha256", key, "clawscarf", "browser-session-logout", 32),
    );
  }
  seal(sessionHash: string, url: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(sessionHash));
    const ciphertext = Buffer.concat([
      cipher.update(url, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    );
  }
  open(sessionHash: string, sealed: string): string {
    const packed = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      packed.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(sessionHash));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
