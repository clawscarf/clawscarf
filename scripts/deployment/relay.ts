import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { observedRelayAddress } from "./networks.js";
import { LocalSetupError, run } from "./process.js";
import type { LocalState } from "./state.js";

export const runtimeRelayHost = "runtime.clawscarf.internal";

/** Fixed TCP destinations; SSH and browser authentication remain end-to-end. */
export function relayConfiguration(state: LocalState, address: string) {
  z.ipv4().parse(address);
  return `global
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
${
  state.input.execution
    ? `
listen execution
  bind ${address}:2222
  server worker host.docker.internal:${String(state.input.execution.port)} resolvers docker init-addr libc,none
`
    : ""
}${
    state.input.browser
      ? `
listen browser
  bind :9223
  server browser browser:9223 resolvers docker init-addr libc,none
`
      : ""
  }`;
}

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
      "The prepared runtime relay differs from its owned network and fixed destinations.",
    );
}

export async function prepareRelay(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  if (!state.input.relayImage) return undefined;
  const address = await observedRelayAddress(directory, state, command);
  if (!address)
    throw new LocalSetupError(
      "network_unprepared",
      "The runtime relay network is not prepared.",
    );
  const path = join(directory, "private/runtime-relay.cfg");
  const content = relayConfiguration(state, address);
  try {
    await verifyFile(path, content);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await writeFile(path, content, { flag: "wx", mode: 0o444 });
    await chmod(path, 0o444);
  }
  return address;
}

/** Starting a deployment observes its policy; it never repairs changed configuration. */
export async function verifyRelayConfiguration(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  if (!state.input.relayImage) return;
  const address = await observedRelayAddress(directory, state, command);
  if (!address)
    throw new LocalSetupError(
      "network_unprepared",
      "The runtime relay network is not prepared.",
    );
  await verifyFile(
    join(directory, "private/runtime-relay.cfg"),
    relayConfiguration(state, address),
  );
}
