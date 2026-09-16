import { z } from "zod";
import { localInput } from "../local/configuration.js";
const path = z.string().min(1);
const disabled = z.strictObject({ mode: z.literal("disabled") });
const resources = z.strictObject({
  cpu: localInput.shape.cpu,
  memory: localInput.shape.memory,
});
export const externalLiteLlmSchema = z.strictObject({
  mode: z.literal("external"),
  configurationFile: path,
  credentialFile: path,
  caFile: path.optional(),
});
export const bundledLiteLlmSchema = z.strictObject({
  mode: z.literal("litellm"),
  configurationFile: path,
  upstreamEnvironmentFile: path,
});
/** Product contract: protection and the shared worker are deliberately not selectable. */
export const installationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: localInput.shape.name,
    recipe: z
      .strictObject({ id: z.string().min(1), release: z.string().min(1) })
      .optional(),
    releaseFile: path,
    stateDirectory: path,
    storage: z.strictObject({ mode: z.literal("docker-volumes") }),
    exposure: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("local"),
        applicationPort: z.number().int().min(1024).max(65535),
        widgetPort: z.number().int().min(1024).max(65535),
      }),
      z.strictObject({
        mode: z.literal("https"),
        applicationOrigin: z.url(),
        widgetOrigin: z.url(),
        certificateFile: path,
        keyFile: path,
      }),
    ]),
    access: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("local"),
        administratorName: localInput.shape.administratorName,
      }),
      z.strictObject({
        mode: z.literal("oidc"),
        administratorName: localInput.shape.administratorName,
        issuer: z.url(),
        clientId: z.string().min(1),
        clientSecretFile: path,
        administratorSubject: z.string().min(1),
        administratorEmail: z.email(),
      }),
    ]),
    resources: z.strictObject({ gateway: resources, worker: resources }),
    browser: z.strictObject({ enabled: z.boolean() }),
    models: z.discriminatedUnion("mode", [
      externalLiteLlmSchema,
      bundledLiteLlmSchema,
    ]),
    connections: z.discriminatedUnion("mode", [
      disabled,
      z.strictObject({
        mode: z.literal("external"),
        brokerUrl: z.string(),
        credentialFile: path,
        caFile: path.optional(),
      }),
      z.strictObject({
        mode: z.literal("local"),
        projectId: z.string().min(1),
        apiKeyFile: path,
        catalogDirectory: path,
      }),
    ]),
    packOperator: z
      .strictObject({
        pythonExecutable: path,
        experimentalClaws: z.literal(true),
      })
      .optional(),
    packs: z
      .array(
        z.strictObject({
          directory: path,
          members: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1),
          bindingsFile: path.optional(),
        }),
      )
      .max(32),
  })
  .superRefine((value, context) => {
    if (Boolean(value.packOperator) !== value.packs.length > 0)
      context.addIssue({
        code: "custom",
        message:
          "Selected packs require a Python OpenShell SDK and explicit experimental Claws acknowledgement; omit packOperator when none are selected.",
      });
    if ((value.access.mode === "local") !== (value.exposure.mode === "local"))
      context.addIssue({
        code: "custom",
        message:
          "Local access requires loopback exposure; company OIDC requires HTTPS.",
      });
  });
export type InstallationConfiguration = z.infer<typeof installationSchema>;

/** Unsaved setup may lack model credentials; persisted installations may not. */
export type InstallationDraft = Omit<InstallationConfiguration, "models"> & {
  models?: InstallationConfiguration["models"];
};
