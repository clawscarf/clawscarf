import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { createClient } from "../../generated/http/client/index.js";
import {
  registerInstallation,
  getInstallationIdentity,
  getAccount,
} from "../../services/cloud/generated/sdk.gen.js";
import { cloudUrlSchema } from "./url.js";
import {
  installationSchema,
  type InstallationConfiguration,
} from "../installation/configuration.js";
import { readInputFile, readJson } from "../installation/files.js";
import { writePrivate, ensurePrivateFile } from "../deployment/state.js";
import { InstallationError } from "../installation/errors.js";
import { configureCloudAi } from "./ai.js";

const identitySchema = z.strictObject({
  issuer: cloudUrlSchema,
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
const administratorSchema = z.strictObject({
  issuer: cloudUrlSchema,
  subject: z.string().min(1),
  email: z.email(),
});
const registrationSchema = z.strictObject({
  cloudUrl: cloudUrlSchema,
  request: z.strictObject({
    reference: z.uuid(),
    name: z.string().min(1),
    origin: cloudUrlSchema.nullable(),
    managementSecret: z.string().min(43),
    runtimeSecret: z.string().min(43),
  }),
  accountId: z.uuid().optional(),
  installationId: z.uuid().optional(),
  identity: identitySchema.optional(),
  administrator: administratorSchema.optional(),
});
export async function readHostedRegistration(file: string) {
  return registrationSchema.parse(
    JSON.parse((await readInputFile(file, true)).toString("utf8")),
  );
}

/** Hosted login and Connections share registration only when they use the same service. */
function connectionsRegistration(config: InstallationConfiguration) {
  if (config.connections.mode !== "hosted") return undefined;
  return config.access.mode === "hosted" &&
    config.access.cloudUrl === config.connections.cloudUrl
    ? config.access
    : config.connections;
}

export function aiRegistration(config: InstallationConfiguration) {
  if (config.models.mode !== "litellm" || !config.models.cloud)
    return undefined;
  const cloud = config.models.cloud;
  return { cloudUrl: cloud.url, registrationFile: cloud.registrationFile };
}

export async function registerCloudServices(
  configFile: string,
  authorize: (
    cloudUrl: string,
    file: string,
    administrator: boolean,
  ) => Promise<string>,
  report?: (message: string) => void,
) {
  const config = installationSchema.parse(await readJson(configFile));
  const connections = connectionsRegistration(config);
  const ai = aiRegistration(config);
  const tokens = new Map<string, string>();
  const authorizeOnce: typeof authorize = async (url, file, administrator) => {
    const cached = tokens.get(url);
    if (cached) return cached;
    const token = await authorize(url, file, administrator);
    tokens.set(url, token);
    return token;
  };
  const selections = [
    ...(config.access.mode === "hosted"
      ? [{ ...config.access, login: true }]
      : []),
    ...(connections && connections !== config.access
      ? [{ ...connections, login: false }]
      : []),
    ...(ai && ai !== config.access && ai !== connections
      ? [{ ...ai, login: false }]
      : []),
  ];
  const registered = new Set<string>();
  for (const selection of selections) {
    const registrationPath = resolve(
      dirname(configFile),
      selection.registrationFile,
    );
    const identity = selection.cloudUrl + "\n" + registrationPath;
    if (registered.has(identity)) continue;
    registered.add(identity);
    const origin = selection.login
      ? config.exposure.mode === "https"
        ? config.exposure.applicationOrigin
        : `http://127.0.0.1:${String(config.exposure.applicationPort)}`
      : null;
    await registerService(
      registrationPath,
      selection.cloudUrl,
      config.name,
      origin,
      authorizeOnce,
      selection.login && !config.access.administratorSubject,
    );
  }
  if (ai) {
    const file = resolve(dirname(configFile), ai.registrationFile);
    await configureCloudAi(
      configFile,
      config.models,
      await readHostedRegistration(file),
      file,
      authorizeOnce,
      report,
    );
    await rm(file + ".login", { force: true });
  }
}

/** Persist intent before dispatch; retries reuse the same reference and keys. */
async function registerService(
  path: string,
  cloudUrl: string,
  name: string,
  origin: string | null,
  authorize: (
    cloudUrl: string,
    file: string,
    administrator: boolean,
  ) => Promise<string>,
  claimAdministrator: boolean,
) {
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
          name,
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
      registration.request.name !== name
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
      const auth = await authorize(
        cloudUrl,
        path + ".login",
        claimAdministrator,
      );
      const account = await getAccount({
        client,
        headers: { authorization: `Bearer ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!account.data) {
        if (account.response?.status === 401)
          await rm(path + ".login", { force: true });
        throw new InstallationError(
          "unavailable",
          "Cloud account could not be verified. Registration has not been dispatched.",
        );
      }
      const { accountId, identity } = z
        .object({
          accountId: z.uuid(),
          identity: administratorSchema.nullable(),
        })
        .parse(account.data);
      if (registration.accountId && registration.accountId !== accountId)
        throw new InstallationError(
          "change_unsupported",
          "Resume registration with the original ClawScarf account.",
        );
      if (claimAdministrator && !identity)
        throw new InstallationError(
          "invalid_configuration",
          "A provisioning credential does not select an administrator. Supply --administrator-subject and --administrator-email during initial configuration, or sign in interactively.",
        );
      registration.accountId = accountId;
      if (claimAdministrator && identity) registration.administrator = identity;
      await writePrivate(path, JSON.stringify(registration));
      const result = await registerInstallation({
        client,
        headers: { authorization: `Bearer ${auth}` },
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
      if (origin && installation.oidcState !== "ready")
        throw new InstallationError(
          "unavailable",
          `Hosted login registration is ${installation.oidcState}. No new client will be allocated; contact the cloud operator.`,
        );
    }
    await rm(path + ".login", { force: true });
    if (!origin) return;
    const result = await getInstallationIdentity({
      client,
      headers: {
        authorization: `Bearer ${registration.request.managementSecret}`,
      },
      path: { id: registration.installationId },
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.data)
      throw new InstallationError(
        "unavailable",
        "Hosted login credentials are unavailable. The saved registration is retained; no keys are replaced.",
      );
    registration.identity = identitySchema.parse(result.data);
    if (
      registration.administrator &&
      registration.administrator.issuer !== registration.identity.issuer
    )
      throw new InstallationError(
        "invalid_configuration",
        "Administrator identity belongs to a different issuer.",
      );
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
  if (
    registration.administrator &&
    registration.administrator.issuer !== registration.identity.issuer
  )
    throw new InstallationError(
      "invalid_configuration",
      "Administrator identity belongs to a different issuer.",
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
    ...(registration.administrator
      ? {
          administratorSubject: registration.administrator.subject,
          administratorEmail: registration.administrator.email,
        }
      : {}),
  };
}

export async function hostedConnections(
  config: InstallationConfiguration,
  configFile: string,
) {
  const selected = connectionsRegistration(config);
  if (!selected) return undefined;
  const file = resolve(dirname(configFile), selected.registrationFile);
  const registration = await readHostedRegistration(file);
  const origin =
    selected === config.access
      ? config.exposure.mode === "https"
        ? config.exposure.applicationOrigin
        : `http://127.0.0.1:${String(config.exposure.applicationPort)}`
      : null;
  if (
    !registration.installationId ||
    registration.cloudUrl !== selected.cloudUrl ||
    registration.request.name !== config.name ||
    registration.request.origin !== origin
  )
    throw new InstallationError(
      "invalid_configuration",
      "Connections registration is incomplete or belongs to another cloud service.",
    );
  const managementKeyFile = file + ".management-key";
  const credentialFile = file + ".runtime-key";
  await ensurePrivateFile(
    managementKeyFile,
    registration.request.managementSecret,
  );
  await ensurePrivateFile(credentialFile, registration.request.runtimeSecret);
  return {
    brokerUrl: `${registration.cloudUrl}/api/connections`,
    managementKeyFile,
    credentialFile,
  };
}

/** Installation-safe billing views use the same registration as each enabled service. */
export async function hostedBilling(
  config: InstallationConfiguration,
  configFile: string,
) {
  const selected = [
    ...(connectionsRegistration(config)
      ? [
          {
            registration: connectionsRegistration(config),
            service: "connections" as const,
          },
        ]
      : []),
    ...(aiRegistration(config)
      ? [{ registration: aiRegistration(config), service: "ai" as const }]
      : []),
  ];
  const targets = new Map<
    string,
    {
      id: string;
      accountId: string;
      url: string;
      managementKeyFile: string;
      ai: boolean;
      connections: boolean;
    }
  >();
  for (const item of selected) {
    if (!item.registration) continue;
    const path = resolve(
      dirname(configFile),
      item.registration.registrationFile,
    );
    const registration = await readHostedRegistration(path);
    if (
      !registration.installationId ||
      !registration.accountId ||
      registration.cloudUrl !== item.registration.cloudUrl
    )
      throw new InstallationError(
        "invalid_configuration",
        "Cloud billing registration is incomplete or belongs to another service.",
      );
    const key = registration.installationId;
    const target = targets.get(key) ?? {
      id: key,
      accountId: registration.accountId,
      url: registration.cloudUrl,
      managementKeyFile: path + ".management-key",
      ai: false,
      connections: false,
    };
    target[item.service] = true;
    await ensurePrivateFile(
      target.managementKeyFile,
      registration.request.managementSecret,
    );
    targets.set(key, target);
  }
  return [...targets.values()];
}
