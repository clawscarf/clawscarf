import { createPrivateKey, X509Certificate } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalSetupError, run } from "./process.js";
import { ensurePrivateFile } from "./state.js";

const names = [
  "management-cert.pem",
  "management-key.pem",
  "management-ca.pem",
];
export async function ensureCertificates(directory: string) {
  const present = await Promise.all(
    names.map(async (name) => {
      try {
        const info = await lstat(join(directory, name));
        if (!info.isFile() || (info.mode & 0o077) !== 0)
          throw new LocalSetupError(
            "invalid_certificate",
            "Management TLS files must be private regular files.",
          );
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return false;
        throw error;
      }
    }),
  );
  if (present.some(Boolean)) {
    if (!present.every(Boolean))
      throw new LocalSetupError(
        "incomplete_certificate",
        "Management TLS initialization is incomplete. Inspect the private TLS files; setup will not replace existing keys.",
      );
    const cert = new X509Certificate(
      await readFile(join(directory, "management-cert.pem")),
    );
    const ca = new X509Certificate(
      await readFile(join(directory, "management-ca.pem")),
    );
    const key = createPrivateKey(
      await readFile(join(directory, "management-key.pem")),
    );
    if (
      !cert.checkPrivateKey(key) ||
      !cert.checkHost("host.docker.internal") ||
      !cert.checkIP("127.0.0.1") ||
      !cert.raw.equals(ca.raw) ||
      !cert.ca ||
      !cert.verify(cert.publicKey) ||
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) <= Date.now()
    )
      throw new LocalSetupError(
        "invalid_certificate",
        "Management TLS material is invalid or expired; setup will not replace it.",
      );
    return;
  }
  const staging = join(directory, "management-tls");
  // A retained staging directory makes an interrupted generation explicit.
  await mkdir(staging, { mode: 0o700 });
  // An explicit config avoids inheriting host-specific certificate extensions.
  const requestConfig = join(staging, "request.cnf");
  await writeFile(requestConfig, "[req]\ndistinguished_name=dn\n[dn]\n");
  await run("openssl", [
    "req",
    "-config",
    requestConfig,
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    join(staging, "key.pem"),
    "-out",
    join(staging, "cert.pem"),
    "-days",
    "365",
    "-subj",
    "/CN=ClawScarf local management",
    "-addext",
    "subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ]);
  const certificate = await readFile(join(staging, "cert.pem"));
  await ensurePrivateFile(
    join(directory, "management-key.pem"),
    await readFile(join(staging, "key.pem")),
  );
  await ensurePrivateFile(join(directory, "management-ca.pem"), certificate);
  await ensurePrivateFile(join(directory, "management-cert.pem"), certificate);
  await rm(staging, { recursive: true });
}
