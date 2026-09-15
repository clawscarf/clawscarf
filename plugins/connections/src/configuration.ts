import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { readConfigFileSnapshot } from "openclaw/plugin-sdk/health";
import {
  mutateConfigFile,
  readConfigFileSnapshotForWrite,
} from "openclaw/plugin-sdk/config-mutation";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "openclaw/plugin-sdk/plugin-config-runtime";

export const PLUGIN_ID = "clawscarf-connections";
export const TOKEN_ENV = "CLAWSCARF_CONNECTIONS_TOKEN";
const provider = { source: "env", allowlist: [TOKEN_ENV] } as const;
const credential = {
  source: "env",
  provider: PLUGIN_ID,
  id: TOKEN_ENV,
} as const;
const connectorTools = [
  "connections_search",
  "connections_describe",
  "connections_call",
] as const;
const requestSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("configure"), Type.Literal("observe")]),
    brokerUrl: Type.String({ maxLength: 2048 }),
    packageDirectory: Type.String({ minLength: 1, maxLength: 4096 }),
    replacePackageDirectories: Type.Array(
      Type.String({ minLength: 1, maxLength: 4096 }),
      { maxItems: 128 },
    ),
  },
  { additionalProperties: false },
);
export type ConfigurationRequest = Static<typeof requestSchema>;

function brokerEndpoint(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      )) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid broker URL.");
  return url.href.replace(/\/$/u, "");
}

function managedProvider(value: unknown): boolean {
  const schema = Type.Object(
    {
      source: Type.Literal("env"),
      allowlist: Type.Tuple([Type.Literal(TOKEN_ENV)]),
    },
    { additionalProperties: false },
  );
  return Check(schema, value);
}

export async function configureConnections(request: ConfigurationRequest) {
  const brokerUrl = brokerEndpoint(request.brokerUrl);
  const snapshot =
    request.kind === "configure"
      ? (await readConfigFileSnapshotForWrite()).snapshot
      : await readConfigFileSnapshot({
          observe: false,
          isolateEnv: true,
          pluginValidation: "core-only",
        });
  if (!snapshot.valid || !snapshot.exists || !snapshot.hash)
    throw new Error("A valid installation configuration is required.");
  if (request.kind === "configure") {
    await mutateConfigFile({
      base: "source",
      baseHash: snapshot.hash,
      afterWrite: {
        mode: "none",
        reason: "The installation service owns restart.",
      },
      writeOptions: { skipOutputLogs: true },
      mutate: (draft) => {
        const currentProvider = draft.secrets?.providers?.[PLUGIN_ID];
        if (currentProvider !== undefined && !managedProvider(currentProvider))
          throw new Error(
            "The managed secret provider has conflicting configuration.",
          );
        draft.secrets ??= {};
        draft.secrets.providers ??= {};
        draft.secrets.providers[PLUGIN_ID] = {
          ...provider,
          allowlist: [TOKEN_ENV],
        };
        draft.plugins ??= {};
        draft.plugins.load ??= {};
        const replaced = new Set(request.replacePackageDirectories);
        draft.plugins.load.paths = [
          ...(draft.plugins.load.paths ?? []).filter(
            (path) => !replaced.has(path) && path !== request.packageDirectory,
          ),
          request.packageDirectory,
        ];
        draft.plugins.entries ??= {};
        const entry = draft.plugins.entries[PLUGIN_ID] ?? {};
        draft.plugins.entries[PLUGIN_ID] = {
          ...entry,
          config: { ...entry.config, brokerUrl, credential },
        };
        draft.tools ??= {};
        draft.tools.sandbox ??= {};
        draft.tools.sandbox.tools ??= {};
        if (draft.tools.sandbox.tools.allow === undefined) {
          const alsoAllow = draft.tools.sandbox.tools.alsoAllow ?? [];
          draft.tools.sandbox.tools.alsoAllow = [
            ...alsoAllow,
            ...connectorTools.filter((tool) => !alsoAllow.includes(tool)),
          ];
        }
      },
    });
  }
  const observed = await readConfigFileSnapshot({
    observe: false,
    isolateEnv: true,
    // Inspect stored settings without resolving plugin metadata from native SQLite state.
    // Mutation retains full validation; this result does not establish loaded tool readiness.
    pluginValidation: "core-only",
  });
  const config = observed.sourceConfig;
  const entry = config.plugins?.entries?.[PLUGIN_ID];
  if (!observed.valid || !observed.hash)
    throw new Error("A valid installation configuration is required.");
  const { enabled } = resolveEffectiveEnableState({
    id: PLUGIN_ID,
    origin: "config",
    config: normalizePluginsConfig(config.plugins),
    rootConfig: config,
  });
  if (
    !entry &&
    !config.plugins?.load?.paths?.includes(request.packageDirectory)
  )
    return { state: "not_installed" } as const;
  const expectedPackage =
    config.plugins?.load?.paths?.includes(request.packageDirectory) === true;
  const managedConfig = Type.Object(
    {
      brokerUrl: Type.Literal(brokerUrl),
      credential: Type.Object(
        {
          source: Type.Literal("env"),
          provider: Type.Literal(PLUGIN_ID),
          id: Type.Literal(TOKEN_ENV),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );
  if (
    !expectedPackage ||
    !Check(managedConfig, entry?.config) ||
    !managedProvider(config.secrets?.providers?.[PLUGIN_ID])
  )
    return { state: "unconfigured", enabled, expectedPackage } as const;
  return {
    state: "configured",
    enabled,
    brokerUrl,
    configHash: observed.hash,
  } as const;
}

export async function configurationCommand(input: unknown) {
  if (!Check(requestSchema, input))
    throw new Error("Invalid configuration request.");
  return configureConnections(input);
}
