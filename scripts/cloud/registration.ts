import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { createClient } from "../../generated/http/client/index.js";
import {
  registerInstallation,
  getInstallationIdentity,
  getAccount,
} from "../../services/cloud/generated/sdk.gen.js";
import { cloudUrlSchema } from "./url.js";
import { installationSchema } from "../installation/configuration.js";
import { readInputFile, readJson } from "../installation/files.js";
import { writePrivate, ensurePrivateFile } from "../deployment/state.js";
import { InstallationError } from "../installation/errors.js";

const identitySchema = z.strictObject({
  issuer: cloudUrlSchema,
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
const registrationSchema = z.strictObject({
  cloudUrl: cloudUrlSchema,
  request: z.strictObject({
    reference: z.uuid(),
    name: z.string().min(1),
    origin: cloudUrlSchema,
    managementSecret: z.string().min(43),
    runtimeSecret: z.string().min(43),
  }),
  accountId: z.uuid().optional(),
  installationId: z.uuid().optional(),
  identity: identitySchema.optional(),
});
export async function readHostedRegistration(file: string) {
  return registrationSchema.parse(
    JSON.parse((await readInputFile(file, true)).toString("utf8")),
  );
}

/** Persist intent before dispatch; retries reuse the same reference and keys. */
export async function registerHostedLogin(
  configFile: string,
  authorize: (cloudUrl: string) => Promise<string>,
) {
  const config = installationSchema.parse(await readJson(configFile));
  if (config.access.mode !== "hosted") return;
  const access = config.access;
  if (!access.cloudUrl)
    throw new InstallationError(
      "unavailable",
      "This development release has no cloud URL. Supply --cloud-url when configuring it, or configure your own OIDC provider.",
    );
  const cloudUrl = cloudUrlSchema.parse(access.cloudUrl);
  const origin =
    config.exposure.mode === "https"
      ? config.exposure.applicationOrigin
      : `http://127.0.0.1:${String(config.exposure.applicationPort)}`;
  const path = resolve(dirname(configFile), access.registrationFile);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const unlock = await lockfile.lock(dirname(path), {
    lockfilePath: path + ".lock",
    retries: 0,
  });
  try {
    let registration: z.infer<typeof registrationSchema>;
    try {
      registration = await readHostedRegistration(path);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      registration = {
        cloudUrl,
        request: {
          reference: randomUUID(),
          name: config.name,
          origin,
          managementSecret: randomBytes(32).toString("base64url"),
          runtimeSecret: randomBytes(32).toString("base64url"),
        },
      };
      await writePrivate(path, JSON.stringify(registration));
    }
    if (
      registration.cloudUrl !== cloudUrl ||
      registration.request.origin !== origin ||
      registration.request.name !== config.name
    )
      throw new InstallationError(
        "change_unsupported",
        "Saved cloud registration belongs to different settings. Do not replace it; use the original installation settings.",
      );
    if (registration.identity) {
      await ensurePrivateFile(
        join(dirname(path), "hosted-oidc-secret"),
        registration.identity.clientSecret,
      );
      return;
    }
    const client = createClient({ baseUrl: cloudUrl, redirect: "error" });
    if (!registration.installationId) {
      const auth = await authorize(cloudUrl);
      const account = await getAccount({
        client,
        auth,
        signal: AbortSignal.timeout(10_000),
      });
      if (!account.data)
        throw new InstallationError(
          "unavailable",
          "Cloud account could not be verified. Registration has not been dispatched.",
        );
      const { accountId } = z
        .object({ accountId: z.uuid() })
        .parse(account.data);
      if (registration.accountId && registration.accountId !== accountId)
        throw new InstallationError(
          "change_unsupported",
          "Resume registration with the original ClawScarf account.",
        );
      registration.accountId = accountId;
      await writePrivate(path, JSON.stringify(registration));
      const result = await registerInstallation({
        client,
        auth,
        body: registration.request,
        signal: AbortSignal.timeout(60_000),
      });
      if (!result.data)
        throw new InstallationError(
          "unavailable",
          `Cloud registration was not confirmed (HTTP ${String(result.response?.status ?? "unavailable")}). Retry this installation with its saved settings.`,
        );
      const installation = z
        .object({
          id: z.uuid(),
          origin: z.string().nullable(),
          oidcState: z.enum([
            "ready",
            "pending",
            "provisioning",
            "failed",
            "uncertain",
            "disabled",
          ]),
        })
        .parse(result.data);
      if (installation.origin !== origin)
        throw new InstallationError(
          "invalid_configuration",
          "Cloud registration returned a different installation origin.",
        );
      registration.installationId = installation.id;
      await writePrivate(path, JSON.stringify(registration));
      if (installation.oidcState !== "ready")
        throw new InstallationError(
          "unavailable",
          `Hosted login registration is ${installation.oidcState}. No new client will be allocated; contact the cloud operator.`,
        );
    }
    const result = await getInstallationIdentity({
      client,
      auth: registration.request.managementSecret,
      path: { id: registration.installationId },
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.data)
      throw new InstallationError(
        "unavailable",
        "Hosted login credentials are unavailable. The saved registration is retained; no keys are replaced.",
      );
    registration.identity = identitySchema.parse(result.data);
    await ensurePrivateFile(
      join(dirname(path), "hosted-oidc-secret"),
      registration.identity.clientSecret,
    );
    await writePrivate(path, JSON.stringify(registration));
  } finally {
    await unlock();
  }
}

export async function hostedOidc(file: string) {
  const registration = await readHostedRegistration(file);
  if (!registration.identity)
    throw new InstallationError(
      "unavailable",
      "Hosted login registration is incomplete. Resume the installer or run configure again.",
    );
  const clientSecretFile = join(dirname(file), "hosted-oidc-secret");
  if (
    (await readInputFile(clientSecretFile, true)).toString("utf8") !==
    registration.identity.clientSecret
  )
    throw new InstallationError(
      "invalid_configuration",
      "Hosted OIDC credentials do not match the saved registration.",
    );
  return {
    issuer: registration.identity.issuer,
    clientId: registration.identity.clientId,
    clientSecretFile,
  };
}
