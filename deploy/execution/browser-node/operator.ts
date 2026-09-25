import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const owner = z.uuid();
const browserSettingsSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    token: z.string().regex(/^[a-f0-9]{64}$/u),
    node: z.string().min(1),
  }),
]);
const inputSchema = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("configure"),
    ownerId: owner,
    settings: browserSettingsSchema,
  }),
  z.strictObject({
    command: z.literal("initialize"),
    ownerId: owner,
    configuration: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ command: z.literal("issue"), gatewayUrl: z.url() }),
  z.strictObject({
    command: z.literal("observe"),
    name: z.string(),
    nodeId: z.string().optional(),
  }),
  z.strictObject({
    command: z.literal("write-code"),
    ownerId: owner,
    setupCode: z.string().min(1),
  }),
  z.strictObject({ command: z.literal("remove-code"), ownerId: owner }),
]);

/** Only the selected browser capability is reapplied; other native settings stay native-owned. */
export function configuredBrowser(
  value: unknown,
  settings: z.infer<typeof browserSettingsSchema>,
) {
  const object = (input: unknown) =>
    z.record(z.string(), z.unknown()).parse(input ?? {});
  const config = object(value);
  const browser = object(config.browser);
  const plugins = object(config.plugins);
  const entries = object(plugins.entries);
  const gateway = object(config.gateway);
  const nodes = object(gateway.nodes);
  const ssrf = object(browser.ssrfPolicy);
  return {
    ...config,
    browser: {
      ...browser,
      enabled: settings.enabled,
      ...(settings.enabled
        ? {
            allowSystemProfileImport: false,
            defaultProfile: "team",
            profiles: {
              ...object(browser.profiles),
              team: {
                cdpUrl: `http://openclaw:${settings.token}@runtime.clawscarf.internal:9223`,
                attachOnly: true,
              },
            },
            ssrfPolicy: {
              ...ssrf,
              allowedHostnames: [
                ...new Set([
                  ...z.array(z.string()).parse(ssrf.allowedHostnames ?? []),
                  "runtime.clawscarf.internal",
                ]),
              ],
            },
          }
        : {}),
    },
    plugins: {
      ...plugins,
      entries: {
        ...entries,
        browser: { ...object(entries.browser), enabled: settings.enabled },
      },
    },
    gateway: {
      ...gateway,
      nodes: {
        ...nodes,
        ...(settings.enabled
          ? { pairing: { ...object(nodes.pairing), autoApproveLocal: false } }
          : {}),
        browser: {
          ...object(nodes.browser),
          mode: settings.enabled ? "manual" : "off",
          ...(settings.enabled ? { node: settings.node } : {}),
        },
      },
    },
  };
}

async function configureBrowser(
  ownerId: string,
  settings: z.infer<typeof browserSettingsSchema>,
) {
  const root = "/home/node/.openclaw";
  for (const name of ["clawscarf-installation.json", "openclaw.json"]) {
    const info = fs.lstatSync(`${root}/${name}`);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("Unsafe native configuration");
  }
  z.object({ ownerId: z.literal(ownerId) }).parse(
    JSON.parse(fs.readFileSync(`${root}/clawscarf-installation.json`, "utf8")),
  );
  const specifier = "openclaw/plugin-sdk/config-mutation";
  const sdk = z.record(z.string(), z.unknown()).parse(await import(specifier));
  const read = sdk.readConfigFileSnapshotForWrite;
  const mutate = sdk.mutateConfigFile;
  if (typeof read !== "function" || typeof mutate !== "function")
    throw new Error("Native SDK unavailable");
  const snapshot = z
    .object({
      snapshot: z.object({
        exists: z.literal(true),
        valid: z.literal(true),
        hash: z.string().min(1),
      }),
    })
    .parse(await Reflect.apply(read, undefined, [])).snapshot;
  await Reflect.apply(mutate, undefined, [
    {
      base: "source",
      baseHash: snapshot.hash,
      afterWrite: {
        mode: "none",
        reason: "The installation service owns restart.",
      },
      writeOptions: { skipOutputLogs: true },
      mutate: (draft: unknown) => {
        const configured = configuredBrowser(draft, settings);
        if (typeof draft !== "object" || draft === null)
          throw new Error("Invalid configuration");
        Object.assign(draft, configured);
      },
    },
  ]);
  return { ok: true };
}

const paired = z.object({
  deviceId: z.string(),
  displayName: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  tokens: z
    .object({
      node: z.object({ revokedAtMs: z.number().optional() }).optional(),
    })
    .optional(),
  nodeSurface: z
    .object({
      displayName: z.string().optional(),
      commands: z.array(z.string()).optional(),
      lastConnectedAtMs: z.number().optional(),
      lastDisconnectedAtMs: z.number().optional(),
    })
    .optional(),
});
function owned(path: string, ownerId: string) {
  const marker = path + "/.clawscarf-owner";
  const stat = fs.lstatSync(marker);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    fs.readFileSync(marker, "utf8") !== ownerId
  )
    throw new Error("Volume ownership differs");
}
async function sdkCall(
  name: "issueDeviceBootstrapToken" | "listDevicePairing",
  args: unknown[],
) {
  const specifier = "openclaw/plugin-sdk/device-bootstrap";
  const loaded: unknown = await import(specifier);
  const sdk = z.record(z.string(), z.unknown()).parse(loaded);
  const method = sdk[name];
  if (typeof method !== "function") throw new Error("Native SDK unavailable");
  const result: unknown = await Reflect.apply(method, undefined, args);
  return result;
}

/** Operator-only helper; its stdout is private transport, never diagnostic output. */
async function main() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (text.length > 131072) throw new Error("Input too large");
  }
  const input = inputSchema.parse(JSON.parse(text));
  if (input.command === "configure")
    return configureBrowser(input.ownerId, input.settings);
  if (input.command === "issue") {
    const issued = z
      .object({ token: z.string(), expiresAtMs: z.number() })
      .parse(
        await sdkCall("issueDeviceBootstrapToken", [
          {
            baseDir: "/home/node/.openclaw",
            profile: { roles: ["node"], scopes: [] },
          },
        ]),
      );
    return {
      setupCode: encodeBrowserSetupCode(input.gatewayUrl, issued),
    };
  }
  if (input.command === "observe") {
    const result = z
      .object({ paired: z.array(paired) })
      .parse(await sdkCall("listDevicePairing", ["/home/node/.openclaw"]));
    return result.paired
      .filter((value) =>
        input.nodeId
          ? value.deviceId === input.nodeId
          : (value.nodeSurface?.displayName ?? value.displayName) ===
            input.name,
      )
      .map((value) => ({
        nodeId: value.deviceId,
        admitted:
          value.roles?.length === 1 &&
          value.roles[0] === "node" &&
          !value.scopes?.length &&
          value.tokens?.node !== undefined &&
          value.tokens.node.revokedAtMs === undefined &&
          value.nodeSurface?.commands?.includes("browser.proxy") === true,
        connectedAt: value.nodeSurface?.lastConnectedAtMs ?? null,
        disconnectedAt: value.nodeSurface?.lastDisconnectedAtMs ?? null,
      }));
  }
  if (input.command === "initialize") {
    for (const path of ["/state", "/configuration"]) {
      const marker = path + "/.clawscarf-owner";
      if (fs.existsSync(marker)) owned(path, input.ownerId);
      else {
        if (fs.readdirSync(path).length) throw new Error("Unowned data");
        fs.writeFileSync(marker, input.ownerId, { flag: "wx", mode: 0o444 });
        fs.chownSync(path, 1000, 1000);
        fs.chmodSync(path, 0o700);
      }
    }
    const path = "/configuration/openclaw.json";
    if (fs.existsSync(path)) {
      const stat = fs.lstatSync(path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        !isDeepStrictEqual(
          JSON.parse(fs.readFileSync(path, "utf8")),
          input.configuration,
        )
      )
        throw new Error("Configuration differs");
    } else {
      fs.writeFileSync(path, JSON.stringify(input.configuration), {
        flag: "wx",
        mode: 0o600,
      });
      fs.chownSync(path, 1000, 1000);
    }
    return { ok: true };
  }
  owned("/configuration", input.ownerId);
  const path = "/configuration/pairing-code";
  if (input.command === "write-code") {
    fs.writeFileSync(path, input.setupCode, { flag: "wx", mode: 0o600 });
    fs.chownSync(path, 1000, 1000);
  } else fs.rmSync(path, { force: true });
  return { ok: true };
}
export async function runBrowserOperator() {
  try {
    process.stdout.write(JSON.stringify(await main()));
  } catch {
    process.stderr.write(
      "Browser operator helper failed; private inputs omitted.\n",
    );
    process.exitCode = 1;
  }
}

export function encodeBrowserSetupCode(
  gatewayUrl: string,
  issued: { token: string; expiresAtMs: number },
) {
  const url = new URL(gatewayUrl);
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("A private TLS Gateway origin is required");
  return Buffer.from(
    JSON.stringify({
      url: url.origin,
      bootstrapToken: issued.token,
      expiresAtMs: issued.expiresAtMs,
    }),
  ).toString("base64url");
}
