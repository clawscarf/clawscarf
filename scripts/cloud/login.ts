import * as oidc from "openid-client";
import { z } from "zod";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../../generated/http/client/index.js";
import { getCliIdentity } from "../../services/cloud/generated/sdk.gen.js";
import { cloudUrlSchema } from "./url.js";
import { readInputFile } from "../installation/files.js";
import { writePrivate } from "../deployment/state.js";
import { InstallationError } from "../installation/errors.js";

const pendingSchema = z.strictObject({
  cloudUrl: cloudUrlSchema,
  issuer: z.url(),
  clientId: z.string().min(1),
  deviceCode: z.string().min(1),
  userCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  expiresAt: z.number(),
  interval: z.number().positive(),
  nextPollAt: z.number(),
  token: z.string().min(1).optional(),
  tokenExpiresAt: z.number().optional(),
});
export class CloudAuthorizationRequired extends Error {
  constructor(
    readonly action: {
      url: string;
      expiresAt: string;
      retryAfterSeconds: number;
    },
  ) {
    super(
      "Sign in to ClawScarf, then run configure again with the same directory.",
    );
  }
}

/** The private OAuth challenge survives terminal exit; resuming never allocates another installation. */
export async function authorizeCloud(
  cloudUrl: string,
  file: string,
  options: {
    wait: boolean;
    present?: (url: string, code: string, expiresAt: string) => void;
    signal?: AbortSignal;
  },
) {
  const client = createClient({
    baseUrl: cloudUrlSchema.parse(cloudUrl),
    redirect: "error",
  });
  const response = await getCliIdentity({
    client,
    signal: AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (!response.data)
    throw new InstallationError(
      "unavailable",
      "ClawScarf login is unavailable. Try again later.",
    );
  const identity = z
    .object({
      issuer: cloudUrlSchema.refine((value) => value.startsWith("https:")),
      clientId: z.string().min(1),
    })
    .parse(response.data);
  const configuration = await oidc.discovery(
    new URL(identity.issuer),
    identity.clientId,
    undefined,
    oidc.None(),
    { timeout: 10 },
  );
  let pending: z.infer<typeof pendingSchema> | undefined;
  try {
    pending = pendingSchema.parse(
      JSON.parse((await readInputFile(file, true)).toString("utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (
    pending &&
    (pending.cloudUrl !== cloudUrl ||
      pending.issuer !== identity.issuer ||
      pending.clientId !== identity.clientId)
  )
    throw new InstallationError(
      "invalid_configuration",
      "Pending authorization belongs to a different cloud identity provider.",
    );
  if (pending?.token) {
    if (pending.tokenExpiresAt && pending.tokenExpiresAt > Date.now())
      return pending.token;
    pending = undefined;
  }
  if (!pending || pending.expiresAt <= Date.now()) {
    const challenge = await oidc.initiateDeviceAuthorization(configuration, {
      scope: "openid profile email",
    });
    pending = pendingSchema.parse({
      cloudUrl,
      ...identity,
      deviceCode: challenge.device_code,
      userCode: challenge.user_code,
      expiresAt: Date.now() + challenge.expires_in * 1000,
      interval: (challenge.interval ?? 5) * 1000,
      nextPollAt: 0,
    });
    await writePrivate(file, JSON.stringify(pending));
  }
  const url = new URL("/setup", cloudUrl);
  url.searchParams.set("code", pending.userCode);
  const required = () =>
    new CloudAuthorizationRequired({
      url: url.href,
      expiresAt: new Date(pending.expiresAt).toISOString(),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((pending.nextPollAt - Date.now()) / 1000),
      ),
    });
  options.present?.(
    url.href,
    pending.userCode,
    new Date(pending.expiresAt).toISOString(),
  );
  for (;;) {
    options.signal?.throwIfAborted();
    if (pending.expiresAt <= Date.now()) {
      await rm(file, { force: true });
      throw new InstallationError(
        "unavailable",
        "Sign-in expired. Run configure again with the same directory for a new link.",
      );
    }
    if (pending.nextPollAt > Date.now()) {
      if (!options.wait) throw required();
      await delay(pending.nextPollAt - Date.now(), undefined, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }
    pending.nextPollAt = Date.now() + pending.interval;
    await writePrivate(file, JSON.stringify(pending));
    try {
      const tokens = await oidc.genericGrantRequest(
        configuration,
        "urn:ietf:params:oauth:grant-type:device_code",
        { device_code: pending.deviceCode },
      );
      pending.token = tokens.access_token;
      pending.tokenExpiresAt = Date.now() + (tokens.expires_in ?? 60) * 1000;
      await writePrivate(file, JSON.stringify(pending));
      return pending.token;
    } catch (error) {
      if (!(error instanceof oidc.ResponseBodyError)) throw error;
      if (error.error === "slow_down") {
        pending.interval += 5000;
        pending.nextPollAt = Date.now() + pending.interval;
        await writePrivate(file, JSON.stringify(pending));
      } else if (error.error !== "authorization_pending") {
        if (
          ["access_denied", "expired_token", "invalid_grant"].includes(
            error.error,
          )
        ) {
          await rm(file, { force: true });
          throw new InstallationError(
            "invalid_configuration",
            "Sign-in was declined or expired. Run configure again with the same directory to retry.",
          );
        }
        throw new InstallationError(
          "unavailable",
          "Cloud authorization failed. Retry configure with the same directory.",
        );
      }
      if (!options.wait) throw required();
    }
  }
}
