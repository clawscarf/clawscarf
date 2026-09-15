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
    application: port,
    widgets: port,
    management: port,
    native: port,
    nativeWidgets: port,
    database: port,
  })
  .refine(
    (value) => new Set(Object.values(value)).size === Object.keys(value).length,
    "Every local listener needs a distinct port.",
  );
const localInput = z.strictObject({
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
});
export type LocalInput = z.infer<typeof localInput>;

/** Local setup derives its network/identity profile; callers cannot supply public ingress. */
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
  const publicOrigin = `http://127.0.0.1:${String(input.ports.application)}`;
  const widgetOrigin = `http://127.0.0.1:${String(input.ports.widgets)}`;
  const access: AccessConfiguration = {
    origin: publicOrigin,
    host: "0.0.0.0",
    port: 18800,
    containerLoopbackPublication: true,
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
    identity: { mode: "local", name: input.administratorName },
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
