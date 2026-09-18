import { OperatorError } from "../errors.js";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { get } from "node:https";
import { join } from "node:path";
import type { LocalInput } from "./configuration.js";
import { ensurePrivateFile } from "./state.js";
import { LocalSetupError } from "./process.js";

export async function readTeamMaterials(team: LocalInput["team"]) {
  try {
    for (const path of [
      ...(team.keyFile ? [team.keyFile] : []),
      team.clientSecretFile,
    ]) {
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0
      )
        throw new OperatorError("Private operator file required.");
    }
    const secret = (await readFile(team.clientSecretFile, "utf8")).trim();
    if (!secret) throw new OperatorError("OIDC secret is empty.");
    if (!team.certificateFile || !team.keyFile) return { secret };
    const certificate = await readFile(team.certificateFile);
    const key = await readFile(team.keyFile);
    const cert = new X509Certificate(certificate);
    if (
      !secret ||
      !cert.checkPrivateKey(createPrivateKey(key)) ||
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) <= Date.now()
    )
      throw new OperatorError("Invalid TLS or OIDC material.");
    for (const origin of [team.origin, team.widgetOrigin]) {
      const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
      if (!(isIP(host) ? cert.checkIP(host) : cert.checkHost(host)))
        throw new OperatorError("Certificate name mismatch.");
    }
    return { certificate, key, secret };
  } catch {
    throw new LocalSetupError(
      "invalid_team_configuration",
      "Team setup requires valid TLS for both public names and private, operator-owned key and OIDC secret files.",
    );
  }
}
export async function prepareTeamFiles(
  directory: string,
  materials: Awaited<ReturnType<typeof readTeamMaterials>>,
) {
  if (materials.certificate) {
    await ensurePrivateFile(
      join(directory, "application-cert.pem"),
      materials.certificate,
    );
    await ensurePrivateFile(
      join(directory, "application-key.pem"),
      materials.key,
    );
  }
  await ensurePrivateFile(
    join(directory, "oidc-client-secret"),
    materials.secret,
  );
}

/** Availability only: company login and native authority require the actual OIDC user. */
export async function probeTeamAccess(
  directory: string,
  input: LocalInput,
  signal: AbortSignal,
) {
  const origin = input.team.origin;
  const ca = await readFile(join(directory, "private/management-ca.pem"));
  await new Promise<void>((resolve, reject) => {
    get(
      {
        hostname: "127.0.0.1",
        servername: "localhost",
        port: input.ports.management,
        path: "/_clawscarf/health",
        headers: { host: new URL(origin).host },
        ca,
        signal,
      },
      (response) => {
        response.resume();
        response.on("error", reject);
        response.on("end", () => {
          if (response.statusCode === 200) resolve();
          else
            reject(
              new LocalSetupError(
                "native_unavailable",
                "Team access has not become healthy.",
              ),
            );
        });
      },
    ).on("error", reject);
  });
}
