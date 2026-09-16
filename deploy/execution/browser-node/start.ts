import { readPrivateFile } from "../../../runtime/private-files.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  nodeArguments,
  validateBrowserNodeConfiguration,
} from "./configuration.js";

const configurationLimit = 64 * 1024;
const pairingCodeLimit = 16 * 1024;

/** Fixed policy/credential inputs; errors deliberately omit private input and causes. */
export async function loadBrowserNodeInputs(
  configPath: string,
  pairingPath: string,
) {
  try {
    const config: unknown = JSON.parse(
      (await readPrivateFile(configPath, configurationLimit))
        .toString("utf8")
        .trim(),
    );
    validateBrowserNodeConfiguration(config);
  } catch {
    throw new Error("Browser node configuration is invalid or unsafe");
  }
  let pairingCode: string | undefined;
  let unsafePairingFile = false;
  try {
    pairingCode = (await readPrivateFile(pairingPath, pairingCodeLimit))
      .toString("utf8")
      .trim();
  } catch (error) {
    unsafePairingFile = !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    );
  }
  if (unsafePairingFile || pairingCode === "") {
    throw new Error("Browser node pairing code is invalid or unsafe");
  }
  return pairingCode === undefined ? {} : { pairingCode };
}

async function start() {
  const configPath = "/configuration/openclaw.json";
  const { pairingCode } = await loadBrowserNodeInputs(
    configPath,
    "/configuration/pairing-code",
  );
  const gatewayUrl = process.env.CLAWSCARF_BROWSER_NODE_GATEWAY_URL;
  if (!gatewayUrl) throw new Error("Browser node Gateway URL is required");
  const allowPrivatePlaintext =
    process.env.CLAWSCARF_BROWSER_NODE_ALLOW_PRIVATE_WS === "1";
  const tlsFingerprint = process.env.CLAWSCARF_BROWSER_NODE_TLS_FINGERPRINT;
  const args = nodeArguments({
    gatewayUrl,
    displayName: process.env.CLAWSCARF_BROWSER_NODE_NAME ?? "ClawScarf browser",
    allowPrivatePlaintext,
    ...(tlsFingerprint ? { tlsFingerprint } : {}),
    ...(pairingCode ? { pairingCode } : {}),
  });
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_STATE_DIR = "/state/native";
  process.env.HOME = "/state";
  process.env.OPENCLAW_NO_RESPAWN = "1";
  process.env.NODE_DISABLE_COMPILE_CACHE = "1";
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_PASSWORD;
  if (allowPrivatePlaintext)
    process.env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS = "1";
  else delete process.env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS;

  // The package root explicitly exports this lifecycle-owned CLI entry. Keeping
  // argv in memory avoids putting the one-use bootstrap credential in OS argv.
  const cli: unknown = await import(pathToFileURL("/app/dist/index.js").href);
  if (
    !cli ||
    typeof cli !== "object" ||
    !("runLegacyCliEntry" in cli) ||
    typeof cli.runLegacyCliEntry !== "function"
  ) {
    throw new Error("Pinned OpenClaw CLI entry is unavailable");
  }
  const running: unknown = Reflect.apply(cli.runLegacyCliEntry, undefined, [
    args,
  ]);
  await running;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await start();
  } catch {
    process.stderr.write(
      "Browser node startup failed; check its private configuration and native runtime.\n",
    );
    process.exitCode = 1;
  }
}
