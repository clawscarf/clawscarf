import { isDeepStrictEqual } from "node:util";

/** The node's policy is operator-owned; only its fixed CDP destination varies. */
export function browserNodeConfiguration(cdpUrl: string) {
  const url = new URL(cdpUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username !== "openclaw" ||
    decodeURIComponent(url.password).length < 32 ||
    url.hash ||
    url.search ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Browser node requires an authenticated HTTP CDP origin");
  }
  return {
    tools: { exec: { mode: "deny" } },
    plugins: { allow: ["browser"], entries: { browser: { enabled: true } } },
    nodeHost: {
      workerRuns: { enabled: false },
      agentRuns: { claude: { enabled: false } },
      skills: { enabled: false },
      browserProxy: { enabled: true, allowProfiles: ["team"] },
    },
    desktop: { host: { enabled: false } },
    browser: {
      enabled: true,
      defaultProfile: "team",
      profiles: { team: { cdpUrl, attachOnly: true } },
      ssrfPolicy: { allowedHostnames: [url.hostname] },
    },
  };
}

export function validateBrowserNodeConfiguration(value: unknown): void {
  function object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Invalid browser node configuration");
    }
    return Object.fromEntries(Object.entries(input));
  }
  const root = object(value);
  const profiles = object(object(root.browser).profiles);
  const cdpUrl = object(profiles.team).cdpUrl;
  if (
    typeof cdpUrl !== "string" ||
    !isDeepStrictEqual(value, browserNodeConfiguration(cdpUrl))
  ) {
    throw new Error("Browser node configuration must retain its fixed policy");
  }
}

export function nodeArguments(input: {
  gatewayUrl: string;
  displayName: string;
  tlsFingerprint?: string;
  pairingCode?: string;
  allowPrivatePlaintext?: boolean;
}): string[] {
  const url = new URL(input.gatewayUrl);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !input.displayName.trim() ||
    (url.protocol === "ws:" && !input.allowPrivatePlaintext)
  ) {
    throw new Error(
      "Browser node requires an explicit secure Gateway endpoint",
    );
  }
  if (
    input.tlsFingerprint &&
    !/^(?:[a-f\d]{2}:?){32}$/i.test(input.tlsFingerprint)
  ) {
    throw new Error("Invalid Gateway certificate fingerprint");
  }
  if (input.tlsFingerprint && url.protocol !== "wss:") {
    throw new Error("Gateway certificate pin requires TLS");
  }
  return [
    process.execPath,
    "/app/openclaw.mjs",
    "node",
    "run",
    "--host",
    url.hostname,
    "--port",
    url.port || (url.protocol === "wss:" ? "443" : "80"),
    "--context-path",
    url.pathname,
    url.protocol === "wss:" ? "--tls" : "--no-tls",
    "--display-name",
    input.displayName,
    "--no-share-installed-apps",
    ...(input.tlsFingerprint
      ? ["--tls-fingerprint", input.tlsFingerprint]
      : []),
    ...(input.pairingCode ? ["--pair", input.pairingCode] : []),
  ];
}
