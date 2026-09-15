import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const owner = z.uuid();
const inputSchema = z.discriminatedUnion("command", [
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
