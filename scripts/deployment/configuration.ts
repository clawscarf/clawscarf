import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { initialConfiguration } from "../../runtime/configuration.js";
import type { AccessConfiguration } from "../../services/access/runtime/config.js";
import { networkRequirementSchema } from "../packs/policy.js";

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
const cpu = z
  .string()
  .regex(
    /^(?:[1-9]\d*m|(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*))$/,
    "Use a positive CPU quantity, such as 2 or 500m.",
  );
const memory = z
  .string()
  .regex(
    /^[1-9]\d*(?:Ki|Mi|Gi|Ti|K|M|G|T)$/,
    "Use a positive memory quantity, such as 512Mi or 2Gi.",
  );
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
const applicationOrigin = z.url().refine((value) => {
  const u = new URL(value);
  return (
    (u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname))) &&
    u.origin === value &&
    !u.username &&
    !u.password
  );
}, "Use an exact HTTPS origin, or HTTP on localhost.");
export const connectionsBrokerUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    let endpoint: URL;
    try {
      endpoint = new URL(value);
    } catch {
      return false;
    }
    return (
      /^https:\/\//iu.test(value) &&
      value.trim() === value &&
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) > 32 &&
          character.charCodeAt(0) !== 127 &&
          character !== "\\",
      ) &&
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash &&
      !value.includes("?") &&
      !value.includes("#") &&
      networkRequirementSchema.safeParse({
        host: endpoint.hostname,
        port: Number(endpoint.port || "443"),
        protocol: "tcp",
        binary: "/usr/local/bin/node",
      }).success
    );
  }, "Use an HTTPS DNS endpoint without credentials, query or fragment.");
export const connectionsInputSchema = z.strictObject({
  mode: z.literal("external"),
  brokerUrl: connectionsBrokerUrlSchema,
  managementKeyFile: absolutePath.optional(),
  caFile: absolutePath.optional(),
});
const teamInput = z
  .strictObject({
    origin: applicationOrigin,
    widgetOrigin: applicationOrigin,
    certificateFile: absolutePath.optional(),
    keyFile: absolutePath.optional(),
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
    administratorSubject: z.string().min(1).optional(),
    administratorEmail: z.email().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.administratorSubject) === Boolean(value.administratorEmail),
    "Provide both administrator subject and email, or neither for a setup link.",
  )
  .refine(
    (value) => value.origin !== value.widgetOrigin,
    "Widgets need a separate origin.",
  )
  .refine((value) => {
    const tls = new URL(value.origin).protocol === "https:";
    return (
      tls === (new URL(value.widgetOrigin).protocol === "https:") &&
      (tls
        ? !!value.certificateFile && !!value.keyFile
        : !value.certificateFile && !value.keyFile)
    );
  }, "HTTPS requires both TLS files; loopback HTTP must not supply TLS files.");
export const localInput = z
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
    openshellClientImage: image,
    ports,
    models: z
      .strictObject({
        configurationFile: absolutePath,
        runtimeKeyFile: absolutePath,
        caFile: absolutePath.optional(),
      })
      .optional(),
    connections: connectionsInputSchema.optional(),
    modelGateway: z
      .strictObject({
        configurationFile: absolutePath,
        upstreamEnvironmentFile: absolutePath,
        image,
        port,
      })
      .optional(),
    cpu,
    memory,
    execution: z.strictObject({ image, port, cpu, memory }).optional(),
    relayImage: image.optional(),
    browser: z
      .strictObject({
        image,
        egressImage: image,
        nodeImage: image,
        dnsImage: image,
        port,
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.modelGateway &&
      (!value.models ||
        [
          ...Object.values(value.ports),
          value.execution?.port,
          value.browser?.port,
        ].includes(value.modelGateway.port))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The model gateway requires native model configuration and a distinct port.",
      });
    if (Boolean(value.relayImage) !== Boolean(value.execution || value.browser))
      ctx.addIssue({
        code: "custom",
        path: ["relayImage"],
        message:
          "Supply the relay image exactly when an execution worker or browser is configured.",
      });
    if (
      value.execution &&
      Object.values(value.ports).includes(value.execution.port)
    )
      ctx.addIssue({
        code: "custom",
        path: ["execution", "port"],
        message: "The execution worker needs a distinct port.",
      });
    if (
      value.browser &&
      (Object.values(value.ports).includes(value.browser.port) ||
        value.execution?.port === value.browser.port)
    )
      ctx.addIssue({
        code: "custom",
        path: ["browser", "port"],
        message: "The browser relay needs a distinct port.",
      });
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

/** A single-host installation uses loopback local identity unless an explicit OIDC team profile is supplied. */
export function parseLocalInput(value: unknown): LocalInput {
  return localInput.parse(value);
}

export function managementOrigin(input: Pick<LocalInput, "ports">): string {
  return `https://host.docker.internal:${String(input.ports.management)}`;
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
    containerLoopbackPublication: !input.team?.certificateFile,
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
      managementOrigin: managementOrigin(input),
      widgetOrigin,
      widgetUpstream: `http://host.docker.internal:${String(input.ports.nativeWidgets)}`,
    },
    ...(input.team?.certificateFile
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
    companion: companionConfiguration(input),
  };
}

export function companionConfiguration(input: LocalInput) {
  return {
    accessConfigurationFile: "/run/clawscarf/access.json",
    ...(input.connections?.mode === "external" &&
    input.connections.managementKeyFile
      ? {
          cloudConnections: {
            url: new URL(input.connections.brokerUrl).origin,
            managementKeyFile: "/run/clawscarf/connections/management-key",
          },
        }
      : {}),
  };
}
