import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { prepareBrowser, initializeBrowserVolume } from "./browser.js";
import { prepareBrowserNode, browserNodeName } from "./browser-node.js";
import { browserOperatorSource } from "./browser-node-helper.js";
import { compose, composeConfiguration } from "./compose.js";
import { ensureLocalNetworks, observedControllerAddress } from "./networks.js";
import { prepareRelay } from "./relay.js";
import { ensureOwnedVolume } from "./volumes.js";
import { verifyBrowserNodeImage } from "./images.js";
import { verifyLocalPorts } from "./preflight.js";
import { resourceNames, writePrivate, type LocalState } from "./state.js";
import { run } from "./process.js";

const browserServices = [
  "browser",
  "browser-egress",
  "browser-relay",
  "browser-node",
  "browser-node-ingress",
  "browser-node-dns",
];
const browserVolumes = [
  "browser",
  "browser-node",
  "browser-node-config",
  "browser-artifacts",
];
const composeSchema = z.looseObject({
  services: z.record(z.string(), z.unknown()),
  networks: z.record(z.string(), z.unknown()),
  volumes: z.record(z.string(), z.unknown()),
});

/** Browser-only replacement, preserving all other prepared services and explicit operator edits. */
export function browserComposeSettings(current: unknown, generated: unknown) {
  const saved = composeSchema.parse(current);
  const next = composeSchema.parse(generated);
  for (const [section, keys] of [
    ["services", browserServices],
    ["networks", ["browser", "machine"]],
    ["volumes", browserVolumes],
  ] as const) {
    const selected = new Set<string>(keys);
    saved[section] = Object.fromEntries([
      ...Object.entries(saved[section]).filter(([key]) => !selected.has(key)),
      ...Object.entries(next[section]).filter(([key]) => selected.has(key)),
    ]);
  }
  return saved;
}

/** Explicit retained edit; caller holds the installation lock and verifies every service is stopped. */
export async function applyBrowserSettings(
  directory: string,
  state: LocalState,
) {
  const names = resourceNames(state);
  const file = join(directory, "compose.json");
  const saved = composeSchema.parse(JSON.parse(await readFile(file, "utf8")));
  if (state.input.browser) {
    await verifyLocalPorts(state);
    await verifyBrowserNodeImage(state.input.browser.nodeImage);
    await ensureLocalNetworks(directory, state);
  }
  const browser = await prepareBrowser(directory, state);
  const machine = browser
    ? await prepareBrowserNode(directory, state, browser.token)
    : undefined;
  if (browser) {
    await ensureOwnedVolume(names.browserVolume, state.ownerId);
    await initializeBrowserVolume(state, browser.token);
    await prepareRelay(directory, state);
  }
  const result: unknown = JSON.parse(
    await run(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--user",
        "1000:1000",
        "--workdir",
        "/app",
        "--env",
        "HOME=/home/node",
        "--env",
        "SQLITE_TMPDIR=/tmp",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
        "--mount",
        `type=volume,source=${names.volume},target=/home/node,volume-nocopy`,
        "--entrypoint",
        "node",
        state.input.runtimeImage,
        "--input-type=module",
        "-e",
        await browserOperatorSource(),
      ],
      {
        input: JSON.stringify({
          command: "configure",
          ownerId: state.ownerId,
          settings: browser
            ? {
                enabled: true,
                token: browser.token,
                node: browserNodeName(state),
              }
            : { enabled: false },
        }),
      },
    ),
  );
  z.strictObject({ ok: z.literal(true) }).parse(result);
  if (!browser) {
    const stopped = browserServices.filter(
      (name) => saved.services[name] !== undefined,
    );
    if (stopped.length) await compose(directory, ["rm", "-f", ...stopped]);
  }
  const generated = composeConfiguration(
    state,
    directory,
    await observedControllerAddress(directory, state),
    browser?.address,
    machine,
  );
  await writePrivate(
    file,
    JSON.stringify(browserComposeSettings(saved, generated), null, 2),
  );
}
