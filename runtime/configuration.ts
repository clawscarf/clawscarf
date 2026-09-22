import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}, "Use HTTPS, or HTTP on loopback, without a path.");

export const configurationInput = z
  .strictObject({
    publicOrigin: origin,
    widgetOrigin: origin,
    standaloneNavigation: z.boolean().default(true),
    agentName: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .refine(
        (value) =>
          [...value].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "Use an agent name without control characters.",
      ),
    administratorIdentity: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          value.trim() === value &&
          [...value].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "Use the exact trusted-ingress identity without whitespace or control characters.",
      ),
  })
  .refine((value) => value.publicOrigin !== value.widgetOrigin, {
    message: "Widgets require a separate origin.",
    path: ["widgetOrigin"],
  });

export function initialConfiguration(
  input: z.input<typeof configurationInput>,
) {
  const settings = configurationInput.parse(input);
  const identity = settings.administratorIdentity;
  return {
    marketplace: { enabled: false },
    gateway: {
      publicOrigin: settings.publicOrigin,
      mode: "local",
      bind: "loopback",
      port: 18789,
      terminal: { enabled: false },
      cliAgents: { enabled: false },
      trustedProxies: ["127.0.0.1"],
      controlUi: {
        allowedOrigins: [settings.publicOrigin],
        communityInvite: false,
        experimental: { customPlugins: settings.standaloneNavigation },
      },
      auth: {
        mode: "trusted-proxy",
        trustedProxy: {
          userHeader: "x-openclaw-user",
          requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],
          allowUsers: [identity],
          allowLoopback: true,
          deviceAutoApprove: { enabled: true, scopes: ["operator.read"] },
        },
        identityScopes: { [identity]: ["operator.admin"] },
      },
      roles: {
        default: "admin",
        definitions: {
          admin: {
            agents: "*",
            scopes: ["operator.admin"],
            sessions: { others: "write" },
          },
          member: {
            agents: "*",
            scopes: ["operator.read", "operator.write", "operator.talk"],
            sessions: { others: "view" },
            sandbox: "inherit",
          },
        },
      },
    },
    agents: {
      entries: {
        main: {
          name: settings.agentName,
          identity: { name: settings.agentName },
        },
      },
      defaults: {
        workspace: "/home/node/.openclaw/workspace",
        sandbox: { mode: "off" },
      },
    },
    plugins: {
      load: {
        paths: [
          "/app/clawscarf/connections",
          "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster",
          ...(settings.standaloneNavigation ? ["/app/clawscarf/access"] : []),
        ],
      },
      entries: {
        "clawscarf-connections": { enabled: false },
        "clawscarf-access": { enabled: settings.standaloneNavigation },
        lobster: { enabled: true },
        codex: {
          enabled: true,
          config: {
            sessionCatalog: { enabled: false },
            appServer: {
              networkProxy: {
                enabled: true,
                baseProfile: "workspace",
                mode: "full",
              },
            },
            codexDynamicToolsExclude: [
              "gateway_exec",
              "gateway_process",
              "gateway",
              "nodes",
              "computer",
              "mobile_ui",
              "terminal",
            ],
          },
        },
        anthropic: { config: { sessionCatalog: { enabled: false } } },
      },
    },
    mcp: {
      apps: {
        enabled: true,
        sandboxPort: 18790,
        sandboxOrigin: settings.widgetOrigin,
      },
    },
    tools: {
      alsoAllow: ["lobster"],
      exec: { host: "gateway", mode: "auto" },
      sessions: { visibility: "self" },
      elevated: { enabled: false },
    },
    browser: {
      headless: true,
      noSandbox: false,
      executablePath: "/usr/bin/chromium",
    },
    models: { catalogRefresh: { enabled: false } },
    discovery: { mdns: { mode: "off" } },
  };
}
