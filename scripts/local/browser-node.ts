import { browserOperatorSource } from "./browser-node-helper.js";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { browserNodeConfiguration } from "../../deploy/execution/browser-node/configuration.js";
import { observedBrowserMachineAddresses } from "./networks.js";
import { ensureOwnedVolume } from "./volumes.js";
import { ensurePrivateFile, resourceNames, type LocalState } from "./state.js";
import { LocalSetupError, run } from "./process.js";

export type BrowserMachineAddresses = {
  node: string;
  ingress: string;
  dns: string;
};
export const browserNodeName = (state: LocalState) =>
  `${resourceNames(state).project}-browser`;

async function certificate(
  directory: string,
  address: string,
  create: boolean,
) {
  const path = join(directory, "private/browser-node.pem");
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600
    )
      throw Error("unsafe");
  } catch (error) {
    if (!(
      create &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw new LocalSetupError(
        "invalid_certificate",
        "Browser node TLS material is missing or unsafe.",
      );
    const staging = join(directory, "private/browser-node-tls");
    await mkdir(staging, { mode: 0o700 });
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-nodes",
      "-days",
      "365",
      "-subj",
      "/CN=ClawScarf browser node",
      "-addext",
      `subjectAltName=IP:${address}`,
      "-keyout",
      join(staging, "key.pem"),
      "-out",
      join(staging, "cert.pem"),
    ]);
    await ensurePrivateFile(
      path,
      Buffer.concat([
        await readFile(join(staging, "key.pem")),
        await readFile(join(staging, "cert.pem")),
      ]),
    );
    await rm(staging, { recursive: true });
  }
  try {
    const pem = await readFile(path);
    const cert = new X509Certificate(pem);
    if (
      !cert.checkPrivateKey(createPrivateKey(pem)) ||
      !cert.checkIP(address) ||
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) <= Date.now()
    )
      throw Error("invalid");
    return cert.fingerprint256;
  } catch {
    throw new LocalSetupError(
      "invalid_certificate",
      "The private browser node certificate is invalid or expired; it was not replaced.",
    );
  }
}

export function browserNodeFiles(addresses: BrowserMachineAddresses) {
  return {
    "browser-node-resolv.conf": `nameserver ${addresses.dns}\noptions timeout:2 attempts:1\n`,
    "browser-node-dns.conf": `server:\n    interface: ${addresses.dns}@53\n    access-control: ${addresses.node}/32 allow\nforward-zone:\n    name: "."\n    forward-first: no\n    forward-addr: 1.1.1.1@53\n    forward-addr: 1.0.0.1@53\n`,
  };
}
async function materialize(
  directory: string,
  addresses: BrowserMachineAddresses,
  create: boolean,
) {
  const files = {
    ...browserNodeFiles(addresses),
    "browser-node-ingress.cfg": await readFile(
      new URL(
        "../../deploy/execution/network/node-ingress.cfg",
        import.meta.url,
      ),
      "utf8",
    ),
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, "private", name);
    try {
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o444 ||
        (await readFile(path, "utf8")) !== content
      )
        throw Error("changed");
    } catch (error) {
      if (!(
        create &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new LocalSetupError(
          "configuration_changed",
          "Private browser node network configuration differs from its prepared inputs.",
        );
      await writeFile(path, content, { flag: "wx", mode: 0o444 });
      await chmod(path, 0o444);
    }
  }
}

export async function prepareBrowserNode(
  directory: string,
  state: LocalState,
  token: string,
) {
  const browser = state.input.browser;
  if (!browser) return undefined;
  const addresses = await observedBrowserMachineAddresses(directory, state);
  if (!addresses)
    throw new LocalSetupError(
      "network_unprepared",
      "The private browser node network is not prepared.",
    );
  const fingerprint = await certificate(directory, addresses.ingress, true);
  await materialize(directory, addresses, true);
  const names = resourceNames(state);
  for (const name of [names.browserNodeVolume, names.browserNodeConfigVolume])
    await ensureOwnedVolume(name, state.ownerId);
  const configuration = browserNodeConfiguration(
    `http://openclaw:${token}@chromium:9223`,
  );
  await run(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--user",
      "0",
      "--workdir",
      "/app",
      "--mount",
      `type=volume,src=${names.browserNodeVolume},dst=/state,volume-nocopy`,
      "--mount",
      `type=volume,src=${names.browserNodeConfigVolume},dst=/configuration,volume-nocopy`,
      "--entrypoint",
      "node",
      browser.nodeImage,
      "--input-type=module",
      "-e",
      await browserOperatorSource(),
    ],
    {
      input: JSON.stringify({
        command: "initialize",
        ownerId: state.ownerId,
        configuration,
      }),
    },
  );
  return { addresses, fingerprint };
}
export async function verifyBrowserNode(directory: string, state: LocalState) {
  if (!state.input.browser) return;
  const addresses = await observedBrowserMachineAddresses(directory, state);
  if (!addresses)
    throw new LocalSetupError(
      "network_unprepared",
      "The private browser node network is not prepared.",
    );
  await certificate(directory, addresses.ingress, false);
  await materialize(directory, addresses, false);
}
export const pairedBrowserSchema = z.strictObject({
  ownerId: z.uuid(),
  nodeId: z.string().min(1),
});
