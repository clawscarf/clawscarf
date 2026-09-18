import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { companionConfiguration } from "./configuration.js";
import { withPreparedDatabase } from "./database.js";
import { initialConnectionsCredential } from "./connections-bootstrap.js";
import {
  loadInitialConnections,
  prepareInitialConnections,
  publishInitialConnections,
  type InitialConnectionsEndpoint,
} from "./connections.js";
import { configureConnectionsVolume } from "./connections-runtime.js";
import { writePrivate, type LocalState } from "./state.js";
import { initialRuntimePolicy } from "./policy.js";

/** Explicit capability edit, with the installation stopped and its operator lock held. */
export async function applyConnectionSettings(
  directory: string,
  state: LocalState,
  previous: InitialConnectionsEndpoint | undefined,
  credentialFile?: string,
) {
  const loaded = await loadInitialConnections(state.input.connections);
  const endpoint = await prepareInitialConnections(directory, loaded, {
    state,
    apply: true,
  });
  const serverId = z
    .object({ serverId: z.uuid() })
    .parse(
      JSON.parse(await readFile(join(directory, "identity.json"), "utf8")),
    ).serverId;
  let credential: { token: string; ca?: string | undefined } | undefined;
  if (endpoint) {
    await withPreparedDatabase(
      directory,
      state,
      loaded?.mode === "local",
      async (pool) => {
        await publishInitialConnections(pool, loaded);
        const issued = await initialConnectionsCredential({
          directory,
          serverId,
          endpoint,
          database: pool,
          ...(credentialFile ? { credentialFile } : {}),
        });
        credential = {
          token: issued.token,
          ...(issued.ca ? { ca: issued.ca } : {}),
        };
      },
    );
  }
  const target = endpoint ?? previous;
  if (target) {
    const result = await configureConnectionsVolume(state, {
      kind: endpoint ? "configure" : "disable",
      ownerId: state.ownerId,
      serverId,
      brokerUrl: target.brokerUrl,
      ...(endpoint ? { enable: true } : {}),
      ...(credential ? { credential } : {}),
    });
    if (
      endpoint
        ? result.state !== "configured" ||
          !result.enabled ||
          result.credentialMatches !== true
        : result.state !== "not_installed" && result.enabled
    )
      throw Error("Connections settings were not confirmed by OpenClaw.");
  }
  await writePrivate(
    join(directory, "private/companion.json"),
    JSON.stringify(companionConfiguration(state.input)),
  );
  // The only Compose mount changed here belongs to Connections. Preserve other services and their addresses.
  const file = join(directory, "compose.json");
  const config = z
    .looseObject({
      services: z.looseObject({
        companion: z.looseObject({ volumes: z.array(z.string()) }),
      }),
    })
    .parse(JSON.parse(await readFile(file, "utf8")));
  const mount = `${join(directory, "private/connections")}:/run/clawscarf/connections:ro`;
  config.services.companion.volumes = config.services.companion.volumes.filter(
    (value) => value !== mount,
  );
  if (loaded?.mode === "local" || loaded?.managementKey)
    config.services.companion.volumes.push(mount);
  await writePrivate(file, JSON.stringify(config));
  const rule =
    initialRuntimePolicy("network_policies: {}", undefined, undefined, endpoint)
      .network_policies.connections_broker ?? null;
  await writePrivate(
    join(directory, "private/connection-policy-change.json"),
    JSON.stringify({ ownerId: state.ownerId, rule }),
  );
}
