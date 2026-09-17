import { runtimeRelayHost } from "./relay.js";
import { randomBytes } from "node:crypto";
import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { observedBrowserAddress } from "./networks.js";
import { LocalSetupError, run } from "./process.js";
import { ensurePrivateFile, resourceNames, type LocalState } from "./state.js";

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Optional browser credentials are independent of model, account and controller keys. */
export async function prepareBrowser(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  if (!state.input.browser) return undefined;
  const path = join(directory, "private/browser-token");
  let token: string;
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.uid !== process.getuid?.()
    )
      throw new LocalSetupError(
        "configuration_changed",
        "The browser credential must remain private and owned by this operator.",
      );
    token = tokenSchema.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    token = randomBytes(32).toString("hex");
    await ensurePrivateFile(path, token);
  }
  const address = await observedBrowserAddress(directory, state, command);
  if (!address)
    throw new LocalSetupError(
      "network_unprepared",
      "The isolated browser network is not prepared.",
    );
  const acl = join(directory, "private/browser-source.acl");
  const content = `${address}/32\n`;
  // Public network data, within the operator's private directory; Squid's UID must read its bind mount.
  try {
    const metadata = await lstat(acl);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o444 ||
      metadata.uid !== process.getuid?.() ||
      (await readFile(acl, "utf8")) !== content
    )
      throw new LocalSetupError(
        "configuration_changed",
        "The browser source rule differs from its reserved network address.",
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await writeFile(acl, content, { flag: "wx", mode: 0o444 });
    await chmod(acl, 0o444);
  }
  await ensurePrivateFile(
    join(directory, "private/browser-seccomp.json"),
    await readFile(
      new URL("../../deploy/execution/browser/seccomp.json", import.meta.url),
    ),
  );
  return { token, address };
}

/** Startup never repairs changed network constraints or substitutes browser credentials. */
export async function verifyBrowserConfiguration(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  if (!state.input.browser) return;
  const address = await observedBrowserAddress(directory, state, command);
  if (!address)
    throw new LocalSetupError(
      "network_unprepared",
      "The isolated browser network is not prepared.",
    );
  const expected = [
    {
      name: "browser-source.acl",
      mode: 0o444,
      content: Buffer.from(`${address}/32\n`),
    },
    {
      name: "browser-seccomp.json",
      mode: 0o600,
      content: await readFile(
        new URL("../../deploy/execution/browser/seccomp.json", import.meta.url),
      ),
    },
  ];
  for (const file of expected) {
    const path = join(directory, "private", file.name);
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== file.mode ||
      !file.content.equals(await readFile(path))
    )
      throw new LocalSetupError(
        "configuration_changed",
        "The prepared browser isolation settings have changed. Inspect them before starting.",
      );
  }
  const path = join(directory, "private/browser-token");
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new LocalSetupError(
      "configuration_changed",
      "The browser credential must remain private and owned by this operator.",
    );
  tokenSchema.parse(await readFile(path, "utf8"));
}

export function browserDefaults(token: string) {
  tokenSchema.parse(token);
  return {
    enabled: true,
    allowSystemProfileImport: false,
    defaultProfile: "team",
    ssrfPolicy: { allowedHostnames: [runtimeRelayHost] },
    profiles: {
      team: {
        cdpUrl: `http://openclaw:${token}@${runtimeRelayHost}:9223`,
        attachOnly: true,
      },
    },
  };
}

export async function initializeBrowserVolume(
  state: LocalState,
  token: string,
) {
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
      "--user",
      "root",
      "--mount",
      `type=volume,source=${resourceNames(state).browserVolume},target=/state,volume-nocopy`,
      "--entrypoint",
      "node",
      state.input.runtimeImage,
      "/app/clawscarf/initialize-browser-main.js",
    ],
    {
      input: JSON.stringify({
        ownerId: state.ownerId,
        token: tokenSchema.parse(token),
      }),
    },
  );
}

/** Readiness observes the authenticated CDP service without opening a page or changing state. */
export async function verifyBrowserListener(directory: string, port: number) {
  const token = tokenSchema.parse(
    await readFile(join(directory, "private/browser-token"), "utf8"),
  );
  const response = await fetch(
    `http://127.0.0.1:${String(port)}/json/version`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new LocalSetupError(
      "browser_unavailable",
      "The shared browser has not become ready.",
    );
  }
  z.object({ Browser: z.string().min(1), webSocketDebuggerUrl: z.url() }).parse(
    await response.json(),
  );
}
