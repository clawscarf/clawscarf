import { readFile } from "node:fs/promises";
import { z } from "zod";
import { validHookPath } from "../providers/hooks.js";
const origin = z
  .string()
  .url()
  .refine(
    (value) => new URL(value).origin === value,
    "Use an exact origin without a path.",
  );
const configSchema = z
  .object({
    origin,
    host: z.string().default("127.0.0.1"),
    containerLoopbackPublication: z.boolean().default(false),
    port: z.number().int().min(1).max(65535).default(18800),
    applicationTls: z
      .strictObject({
        certificateFile: z.string().min(1),
        keyFile: z.string().min(1),
      })
      .optional(),
    managementTls: z
      .object({
        certificateFile: z.string().min(1),
        keyFile: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        host: z.string().default("127.0.0.1"),
      })
      .strict()
      .optional(),
    databaseUrl: z.string().min(1),
    encryptionKeyFile: z.string().min(1),
    runtime: z
      .object({
        origin: origin,
        managementOrigin: origin.optional(),
        webhookPaths: z
          .array(
            z.string().refine(validHookPath, "Use an exact native hook path."),
          )
          .max(98)
          .optional(),
        widgetOrigin: origin.optional(),
        widgetUpstream: origin.optional(),
      })
      .strict(),
    identity: z.discriminatedUnion("mode", [
      z
        .object({
          mode: z.literal("local"),
          name: z.string().min(1).default("Administrator"),
        })
        .strict(),
      z
        .object({
          mode: z.literal("oidc"),
          issuer: z
            .string()
            .url()
            .refine((value) => {
              const url = new URL(value);
              return !url.username && !url.password && !url.search && !url.hash;
            }, "Use an issuer URL without credentials, query or fragment."),
          clientId: z.string().min(1),
          clientSecretFile: z.string().min(1),
          administratorSubject: z.string().min(1).optional(),
          administratorEmail: z.string().email().optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type AccessConfiguration = z.infer<typeof configSchema>;
export async function readConfiguration(
  path: string,
): Promise<AccessConfiguration> {
  const config = configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const hostname = new URL(config.origin).hostname;
  if (
    config.identity.mode === "oidc" &&
    Boolean(config.identity.administratorSubject) !==
      Boolean(config.identity.administratorEmail)
  )
    throw Error(
      "Provide both administrator subject and email, or neither for a setup link.",
    );
  if (config.applicationTls && new URL(config.origin).protocol !== "https:")
    throw Error("Application TLS requires an HTTPS origin.");
  if (
    (config.identity.mode === "local" ||
      new URL(config.origin).protocol === "http:") &&
    (!["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
      (!["127.0.0.1", "::1"].includes(config.host) &&
        !(config.containerLoopbackPublication && config.host === "0.0.0.0")))
  )
    throw Error("Local access binds only to loopback.");
  if (
    config.identity.mode === "oidc" &&
    new URL(config.origin).protocol !== "https:" &&
    !(
      new URL(config.origin).protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(hostname)
    )
  )
    throw Error("Network-accessible OIDC requires HTTPS.");
  if (
    Boolean(config.runtime.widgetOrigin) !==
    Boolean(config.runtime.widgetUpstream)
  )
    throw Error("Configure widget origin and upstream together.");
  if (config.runtime.widgetOrigin) {
    const widget = new URL(config.runtime.widgetOrigin);
    if (
      widget.protocol !== "https:" &&
      !(
        widget.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(widget.hostname) &&
        (["127.0.0.1", "::1"].includes(config.host) ||
          (config.containerLoopbackPublication && config.host === "0.0.0.0"))
      )
    )
      throw Error("Network-accessible widgets require HTTPS.");
  }
  if (config.runtime.widgetOrigin === config.origin)
    throw Error("Widgets need a separate origin.");
  if (
    config.managementTls &&
    (!config.runtime.managementOrigin ||
      new URL(config.runtime.managementOrigin).protocol !== "https:")
  )
    throw Error("Management TLS requires an HTTPS management origin.");
  if (
    config.identity.mode === "local" &&
    config.managementTls &&
    !["127.0.0.1", "::1"].includes(config.managementTls.host) &&
    !(
      config.containerLoopbackPublication &&
      config.managementTls.host === "0.0.0.0"
    )
  )
    throw Error("Local management TLS binds only to loopback.");
  return config;
}
