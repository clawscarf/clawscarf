import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalSetupError } from "./process.js";
import type { LocalState } from "./state.js";

export const runtimeRelayHost = "runtime.clawscarf.internal";

/** Fixed browser TCP destination; authentication remains end-to-end. */
export const browserRelayConfiguration = `global
  maxconn 256
  nbthread 1

defaults
  mode tcp
  timeout connect 5s
  timeout client 0
  timeout server 0
  option clitcpka
  option srvtcpka

resolvers docker
  nameserver dns 127.0.0.11:53
  resolve_retries 3
  timeout resolve 1s
  timeout retry 1s
  hold valid 10s

listen browser
  bind :9223
  server browser browser:9223 resolvers docker init-addr libc,none
`;

async function verifyFile(path: string, expected: string) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o444 ||
    (await readFile(path, "utf8")) !== expected
  )
    throw new LocalSetupError(
      "configuration_changed",
      "The prepared browser relay differs from its fixed destination.",
    );
}

export async function prepareRelay(directory: string, state: LocalState) {
  if (!state.input.relayImage) return undefined;
  const path = join(directory, "private/browser-relay.cfg");
  const content = browserRelayConfiguration;
  try {
    await verifyFile(path, content);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await writeFile(path, content, { flag: "wx", mode: 0o444 });
    await chmod(path, 0o444);
  }
}

/** Starting a deployment observes its policy; it never repairs changed configuration. */
export async function verifyRelayConfiguration(
  directory: string,
  state: LocalState,
) {
  if (!state.input.relayImage) return;
  await verifyFile(
    join(directory, "private/browser-relay.cfg"),
    browserRelayConfiguration,
  );
}
