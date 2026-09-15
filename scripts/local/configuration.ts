import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { initialConfiguration } from "../../runtime/configuration.js";
import type { AccessConfiguration } from "../../services/access/runtime/config.js";

const absolutePath = z
  .string()
  .min(1)
  .refine(isAbsolute, "Use an absolute path.");
const image = z
  .string()
  .regex(
    /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/,
    "Use an exact image ID or image reference with a SHA-256 digest.",
  );
const port = z.number().int().min(1024).max(65535);
const ports = z
  .strictObject({
    controller: port,
    application: z.number().int().min(1).max(65535),
    widgets: z.number().int().min(1).max(65535),
    management: port,
    native: port,
    nativeWidgets: port,
    database: port,
  })
  .refine(
    (value) => new Set(Object.values(value)).size === Object.keys(value).length,
    "Every local listener needs a distinct port.",
  );
const httpsOrigin = z.url().refine((value) => {
  const u = new URL(value);
  return (
    u.protocol === "https:" && u.origin === value && !u.username && !u.password
  );
}, "Use an exact HTTPS origin.");
const teamInput = z
  .strictObject({
    origin: httpsOrigin,
    widgetOrigin: httpsOrigin,
    certificateFile: absolutePath,
    keyFile: absolutePath,
    issuer: z.url().refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }, "Use an HTTPS OIDC issuer without credentials, query or fragment."),
    clientId: z.string().min(1),
    clientSecretFile: absolutePath,
    administratorSubject: z.string().min(1),
    administratorEmail: z.email(),
  })
  .refine(
    (value) => value.origin !== value.widgetOrigin,
    "Widgets need a separate origin.",
  );
const localInput = z
  .strictObject({
    team: teamInput.optional(),
    name: z
      .string()
      .max(30)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    administratorName: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (value) =>
          value.trim().length > 0 &&
          Array.from(value).every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "Use a display name without control characters.",
      ),
    runtimeImage: image,
    companionImage: image,
    openshellCli: absolutePath,
    openshellGateway: absolutePath,
    ports,
    models: z
      .strictObject({
        configurationFile: absolutePath,
        runtimeKeyFile: absolutePath,
        caFile: absolutePath.optional(),
      })
      .optional(),
    cpu: z
      .string()
      .regex(
        /^(?:[1-9]\d*m|(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*))$/,
        "Use a positive CPU quantity, such as 2 or 500m.",
      ),
    memory: z
      .string()
      .regex(
        /^[1-9]\d*(?:Ki|Mi|Gi|Ti|K|M|G|T)$/,
        "Use a positive memory quantity, such as 512Mi or 2Gi.",
      ),
  })
  .superRefine((value, ctx) => {
    if (!value.team) return;
    for (const [key, port] of [
      ["origin", value.ports.application],
      ["widgetOrigin", value.ports.widgets],
    ] as const) {
      if (Number(new URL(value.team[key]).port || "443") !== port)
        ctx.addIssue({
          code: "custom",
          path: ["team", key],
          message: "The public origin must use its configured published port.",
        });
    }
  });
export type LocalInput = z.infer<typeof localInput>;

/** A single-host installation uses loopback local identity unless an explicit HTTPS/OIDC team profile is supplied. */
export function parseLocalInput(value: unknown): LocalInput {
  return localInput.parse(value);
}

function mountedPrivateFile(
  directory: string,
  path: string,
  name: string,
): string {
  absolutePath.parse(path);
  if (resolve(path) !== join(directory, name))
    throw Error(
      `The local configuration requires ${name} in its private directory.`,
    );
  return `/run/clawscarf/${name}`;
}

export function generateLocalConfiguration(options: {
  input: LocalInput;
  directory: string;
  encryptionKeyPath: string;
  managementCertificatePath: string;
  managementKeyPath: string;
  runtimeDatabaseUrl: string;
  administratorIdentity: string;
}) {
  const input = parseLocalInput(options.input);
  const directory = resolve(absolutePath.parse(options.directory));
  const identity = z
    .string()
    .refine(
      (value) =>
        value.startsWith("clawscarf:") &&
        z.uuid().safeParse(value.slice("clawscarf:".length)).success,
      "Use the local Access service's exact ClawScarf administrator identity.",
    )
    .parse(options.administratorIdentity);
  const database = z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "Use a PostgreSQL connection URL.",
    )
    .parse(options.runtimeDatabaseUrl);
  const publicOrigin =
    input.team?.origin ?? `http://127.0.0.1:${String(input.ports.application)}`;
  const widgetOrigin =
    input.team?.widgetOrigin ??
    `http://127.0.0.1:${String(input.ports.widgets)}`;
  const access: AccessConfiguration = {
    origin: publicOrigin,
    host: "0.0.0.0",
    port: 18800,
    containerLoopbackPublication: !input.team,
    databaseUrl: database,
    encryptionKeyFile: mountedPrivateFile(
      directory,
      options.encryptionKeyPath,
      "encryption.key",
    ),
    managementTls: {
      certificateFile: mountedPrivateFile(
        directory,
        options.managementCertificatePath,
        "management-cert.pem",
      ),
      keyFile: mountedPrivateFile(
        directory,
        options.managementKeyPath,
        "management-key.pem",
      ),
      host: "0.0.0.0",
      port: 18801,
    },
    runtime: {
      origin: `http://host.docker.internal:${String(input.ports.native)}`,
      managementOrigin: `https://host.docker.internal:${String(input.ports.management)}`,
      widgetOrigin,
      widgetUpstream: `http://host.docker.internal:${String(input.ports.nativeWidgets)}`,
    },
    ...(input.team
      ? {
          applicationTls: {
            certificateFile: "/run/clawscarf/application-cert.pem",
            keyFile: "/run/clawscarf/application-key.pem",
          },
        }
      : {}),
    identity: input.team
      ? {
          mode: "oidc",
          issuer: input.team.issuer,
          clientId: input.team.clientId,
          clientSecretFile: "/run/clawscarf/oidc-client-secret",
          administratorSubject: input.team.administratorSubject,
          administratorEmail: input.team.administratorEmail,
        }
      : { mode: "local", name: input.administratorName },
  };
  const native = initialConfiguration({
    publicOrigin,
    widgetOrigin,
    administratorIdentity: identity,
  });
  native.gateway.port = input.ports.native;
  native.mcp.apps.sandboxPort = input.ports.nativeWidgets;
  return {
    access,
    native,
    companion: { accessConfigurationFile: "/run/clawscarf/access.json" },
  };
}
