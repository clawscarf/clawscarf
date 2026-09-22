import { lookup } from "node:dns/promises";
import { isPublicAddress } from "./public-addresses.js";
import { LocalSetupError, run } from "./process.js";
import { loadInitialModels } from "./models.js";
import { loadInitialConnections } from "./connections.js";
import { resourceNames, type LocalState } from "./state.js";

type ServiceNetworks = {
  models?: { host: string; port: number } | undefined;
  connections?: { host: string; port: number } | undefined;
};

/** Host DNS is an early compatibility check, not proof of runtime connectivity. */
export async function validatePublicWebServices(
  enabled: boolean,
  services: ServiceNetworks,
  resolve = (host: string) => lookup(host, { all: true }),
) {
  if (!enabled) return;
  for (const name of ["models", "connections"] as const) {
    const endpoint = services[name];
    if (!endpoint || ![80, 443].includes(endpoint.port)) continue;
    let addresses;
    try {
      addresses = await resolve(endpoint.host);
    } catch {
      throw new LocalSetupError(
        "invalid_runtime_policy",
        `The ${name} endpoint could not be resolved for public-web validation. Check its DNS configuration before continuing.`,
      );
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new LocalSetupError(
        "invalid_runtime_policy",
        `The ${name} endpoint resolves to private or reserved addresses on port ${String(endpoint.port)}. Turn Public web off or use a service port outside 80/443. This OpenShell version cannot combine those policies.`,
      );
  }
}

// Runs inside the protected runtime. A CONNECT success proves the actual proxy route,
// without sending service credentials or treating TLS/application health as established.
const proxyProbe = `
import http from 'node:http';
const [host, port] = process.argv.slice(1);
const outcome = await new Promise(resolve => {
  const request = http.request(process.env.HTTPS_PROXY, {
    method: 'CONNECT', path: host + ':' + port, agent: false,
  });
  request.setTimeout(8000, () => request.destroy(new Error('timeout')));
  request.on('error', () => resolve('unavailable'));
  request.on('connect', (response, socket) => {
    socket.destroy();
    resolve(response.statusCode === 200 ? 'connected' : response.statusCode === 403 ? 'blocked' : 'unavailable');
  });
  request.end();
});
console.log(outcome);
`;

export async function verifyServiceRoutes(
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: typeof run = run,
) {
  const services: ServiceNetworks = {
    models: (await loadInitialModels(state.input.models))?.network,
    connections: (await loadInitialConnections(state.input.connections))
      ?.endpoint.network,
  };
  const name = resourceNames(state).sandbox;
  for (const service of ["models", "connections"] as const) {
    const endpoint = services[service];
    if (!endpoint) continue;
    let outcome;
    try {
      outcome = (
        await command(
          state.input.openshellCli,
          [
            "sandbox",
            "exec",
            "--name",
            name,
            "--gateway",
            name,
            "--no-tty",
            "--timeout",
            "15",
            "--",
            "node",
            "--input-type=module",
            "-e",
            proxyProbe,
            endpoint.host,
            String(endpoint.port),
          ],
          { env, timeout: 25000 },
        )
      ).trim();
    } catch (error) {
      throw new LocalSetupError(
        "native_unavailable",
        `The runtime ${service} network check did not complete. Inspect the runtime before retrying.`,
        error instanceof LocalSetupError ? error.commandFailure : undefined,
      );
    }
    if (outcome !== "connected")
      throw new LocalSetupError(
        "invalid_runtime_policy",
        outcome === "blocked"
          ? `The runtime network policy blocks the configured ${service} endpoint. Review Public web and the service policy before starting.`
          : `The configured ${service} endpoint is unreachable through the runtime proxy. Check the service and its DNS/network settings before starting.`,
      );
  }
}
