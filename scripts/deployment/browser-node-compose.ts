import { join } from "node:path";
import {
  browserNodeName,
  type BrowserMachineAddresses,
} from "./browser-node.js";
import { resourceNames, type LocalState } from "./state.js";

export function browserNodeServices(
  state: LocalState,
  directory: string,
  browserAddress: string,
  prepared: { addresses: BrowserMachineAddresses; fingerprint: string },
) {
  const input = state.input.browser;
  if (!input || !state.input.relayImage)
    throw Error("Browser images are required.");
  const { addresses, fingerprint } = prepared;
  const file = (name: string) => join(directory, "private", name);
  const constrained = {
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    init: true,
    labels: { "clawscarf.installation": state.ownerId },
  };
  return {
    "browser-node": {
      ...constrained,
      image: input.nodeImage,
      user: "1000:1000",
      networks: { machine: { ipv4_address: addresses.node }, browser: {} },
      extra_hosts: [`chromium:${browserAddress}`],
      environment: {
        CLAWSCARF_BROWSER_NODE_GATEWAY_URL: `wss://${addresses.ingress}:18803`,
        CLAWSCARF_BROWSER_NODE_TLS_FINGERPRINT: fingerprint,
        CLAWSCARF_BROWSER_NODE_NAME: browserNodeName(state),
      },
      volumes: [
        "browser-node:/state",
        "browser-node-config:/configuration:ro",
        `${file("browser-node-resolv.conf")}:/etc/resolv.conf:ro`,
      ],
      tmpfs: ["/tmp:rw,noexec,nosuid,nodev,size=128m"],
      mem_limit: "1g",
      pids_limit: 128,
      depends_on: ["browser", "browser-node-ingress", "browser-node-dns"],
    },
    "browser-node-ingress": {
      ...constrained,
      image: state.input.relayImage,
      user: String(process.getuid?.() ?? 1000),
      networks: { machine: { ipv4_address: addresses.ingress }, default: {} },
      environment: {
        CLAWSCARF_NODE_INGRESS_ADDRESS: addresses.ingress,
        CLAWSCARF_NODE_GATEWAY_PORT: String(state.input.ports.native),
      },
      volumes: [
        `${file("browser-node.pem")}:/run/clawscarf/node-ingress.pem:ro`,
        `${file("browser-node-ingress.cfg")}:/usr/local/etc/haproxy/haproxy.cfg:ro`,
      ],
      mem_limit: "64m",
      pids_limit: 64,
    },
    "browser-node-dns": {
      ...constrained,
      image: input.dnsImage,
      networks: { machine: { ipv4_address: addresses.dns }, default: {} },
      sysctls: {
        "net.ipv4.ip_unprivileged_port_start": "53",
        "net.ipv4.ip_forward": "0",
      },
      volumes: [
        `${file("browser-node-dns.conf")}:/etc/unbound/deployment.conf:ro`,
      ],
      mem_limit: "128m",
      pids_limit: 32,
    },
  };
}
export function browserNodeVolumes(state: LocalState) {
  const names = resourceNames(state);
  return {
    "browser-node": { external: true, name: names.browserNodeVolume },
    "browser-node-config": {
      external: true,
      name: names.browserNodeConfigVolume,
    },
  };
}
