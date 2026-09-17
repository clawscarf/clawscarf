import * as oidc from "openid-client";
import { z } from "zod";
import { createClient } from "../../generated/http/client/index.js";
import { getCliIdentity } from "../../services/cloud/generated/sdk.gen.js";
import { cloudUrlSchema } from "./url.js";
import { InstallationError } from "../installation/errors.js";

export async function authorizeCloud(
  cloudUrl: string,
  present: (url: string, code: string) => void,
  signal?: AbortSignal,
) {
  const client = createClient({
    baseUrl: cloudUrlSchema.parse(cloudUrl),
    redirect: "error",
  });
  const response = await getCliIdentity({
    client,
    signal: AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(signal ? [signal] : []),
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
  const issuer = new URL(identity.issuer);
  const configuration = await oidc.discovery(
    issuer,
    identity.clientId,
    undefined,
    oidc.None(),
    {
      timeout: 10,
    },
  );
  const challenge = await oidc.initiateDeviceAuthorization(configuration, {
    scope: "openid profile email",
  });
  present(
    challenge.verification_uri_complete ?? challenge.verification_uri,
    challenge.user_code,
  );
  const tokens = await oidc.pollDeviceAuthorizationGrant(
    configuration,
    challenge,
    undefined,
    { ...(signal ? { signal } : {}) },
  );
  return tokens.access_token;
}
