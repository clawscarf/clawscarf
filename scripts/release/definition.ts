import { z } from "zod";

import { liteLlmImage, postgresImage } from "../deployment/images.js";

export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z
  .string()
  .regex(
    /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/,
  );
const file = z.strictObject({
  file: z.string().min(1),
  sha256: digest,
  url: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" && !url.username && !url.password && !url.hash
      );
    }, "Tool downloads require HTTPS without credentials.")
    .optional(),
});
export const hostPlatformSchema = z.enum([
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
]);
const tool = z.union([file, z.partialRecord(hostPlatformSchema, file)]);
/** Pinned runtime metadata, independent of recipe defaults and deployment state. */
export const releaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  platforms: z.array(hostPlatformSchema).min(1),
  images: z
    .strictObject({
      postgres: z.literal(postgresImage),
      gateway: image,
      companion: image,
      openshellClient: image,
      relay: image.optional(),
      models: z.literal(liteLlmImage).optional(),
      browser: z
        .strictObject({
          chromium: image,
          node: image,
          dns: image,
          egress: image,
        })
        .optional(),
    })
    .refine((images) => Boolean(images.browser) === Boolean(images.relay), {
      message: "Browser and relay images must be supplied together.",
    }),
  tools: z.strictObject({
    openshell: z.strictObject({
      version: z.string().min(1),
      cli: tool,
      gateway: tool,
    }),
  }),
});
export type Release = z.infer<typeof releaseSchema>;

/** Published manifests must work without checkout-local images or executables. */
export function assertPublishedRuntime(runtime: Release) {
  if (
    JSON.stringify(runtime.images).includes('"sha256:') ||
    runtime.platforms.some((platform) => {
      const tools = releaseTools(runtime, platform);
      return !tools.cli.url || !tools.gateway.url;
    })
  )
    throw Error(
      "Published runtimes require registry digests and downloadable tools.",
    );
}

/** Single-platform development bundles and multi-platform published bundles share resolution. */
export function releaseTools(
  release: Release,
  platform = `${process.platform}-${process.arch}`,
) {
  const host = hostPlatformSchema.parse(platform);
  if (!release.platforms.includes(host))
    throw new Error(`Runtime ${release.version} does not include ${host}.`);
  const select = (value: z.infer<typeof tool>) => {
    if ("file" in value) {
      if (release.platforms.length !== 1)
        throw new Error(
          "Multi-platform runtimes require a tool for each platform.",
        );
      return value;
    }
    const selected = value[host];
    if (!selected) throw new Error(`Missing runtime tool for ${host}.`);
    return selected;
  };
  return {
    cli: select(release.tools.openshell.cli),
    gateway: select(release.tools.openshell.gateway),
  };
}
