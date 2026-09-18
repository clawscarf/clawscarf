import { controllerServices } from "./controller-compose.js";
import {
  browserNodeServices,
  browserNodeVolumes,
} from "./browser-node-compose.js";
import type { BrowserMachineAddresses } from "./browser-node.js";
import { join } from "node:path";
import type { LocalState } from "./state.js";
import { resourceNames } from "./state.js";
import { run } from "./process.js";
import { modelGatewayServices } from "./model-gateway-compose.js";

import { postgresImage } from "./images.js";
export function composeConfiguration(
  state: LocalState,
  directory: string,
  browserAddress?: string,
  browserMachine?: { addresses: BrowserMachineAddresses; fingerprint: string },
) {
  const { input, ownerId } = state;
  const names = resourceNames(state);
  const privateDirectory = join(directory, "private");
  const labels = { "clawscarf.installation": ownerId };
  if (input.browser && (!browserAddress || !browserMachine))
    throw Error(
      "The isolated browser address and prepared native node are required.",
    );
  const constrained = {
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    init: true,
    labels,
  };
  const configuration = {
    name: names.project,
    services: {
      ...controllerServices(directory, state),
      ...modelGatewayServices(directory, state),
      ...(input.browser && browserAddress && browserMachine
        ? browserNodeServices(state, directory, browserAddress, browserMachine)
        : {}),
      ...(input.browser
        ? {
            browser: {
              ...constrained,
              image: input.browser.image,
              user: "1000:1000",
              networks: {
                browser: { ipv4_address: browserAddress, aliases: ["browser"] },
              },
              security_opt: [
                ...constrained.security_opt,
                `seccomp:${join(privateDirectory, "browser-seccomp.json")}`,
              ],
              environment: {
                CLAWSCARF_BROWSER_TOKEN_FILE: "/state/.clawscarf-browser/token",
                CLAWSCARF_BROWSER_PROXY_SERVER: "http://browser-egress:3128",
              },
              volumes: ["browser:/state"],
              tmpfs: ["/tmp:rw,nosuid,nodev,size=512m"],
              shm_size: "256m",
              mem_limit: "1g",
              pids_limit: 256,
              stop_grace_period: "15s",
              depends_on: ["browser-egress"],
            },
            "browser-egress": {
              ...constrained,
              image: input.browser.egressImage,
              networks: {
                default: {},
                browser: { aliases: ["browser-egress"] },
              },
              volumes: [
                `${join(privateDirectory, "browser-source.acl")}:/etc/squid/browser-source.acl:ro`,
              ],
              tmpfs: ["/tmp"],
              mem_limit: "128m",
              pids_limit: 64,
            },
          }
        : {}),
      ...(input.relayImage
        ? {
            "browser-relay": {
              ...constrained,
              image: input.relayImage,
              user: "1000:1000",
              networks: {
                runtime: {
                  aliases: ["runtime.clawscarf.internal"],
                },
                ...(input.browser ? { browser: {} } : {}),
              },
              volumes: [
                `${join(privateDirectory, "browser-relay.cfg")}:/usr/local/etc/haproxy/haproxy.cfg:ro`,
              ],
              ...(input.browser
                ? {
                    ports: [`127.0.0.1:${String(input.browser.port)}:9223`],
                    depends_on: ["browser"],
                  }
                : {}),
              mem_limit: "64m",
              pids_limit: 64,
            },
          }
        : {}),
      postgres: {
        image: postgresImage,
        environment: {
          POSTGRES_DB: "clawscarf",
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD_FILE: "/run/secrets/database_password",
        },
        secrets: ["database_password"],
        volumes: ["database:/var/lib/postgresql/data"],
        ports: [`127.0.0.1:${String(input.ports.database)}:5432`],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U postgres -d clawscarf"],
          interval: "2s",
          timeout: "3s",
          retries: 30,
        },
        labels,
      },
      companion: {
        image: input.companionImage,
        user: `${String(process.getuid?.() ?? 1000)}:${String(process.getgid?.() ?? 1000)}`,
        environment: {
          NODE_EXTRA_CA_CERTS: "/run/clawscarf/management-ca.pem",
          CLAWSCARF_COMPANION_CONFIG: "/run/clawscarf/companion.json",
        },
        volumes: [
          "access.json",
          "companion.json",
          "encryption.key",
          "management-ca.pem",
          "management-cert.pem",
          "management-key.pem",
          ...(input.connections?.managementKeyFile ? ["connections"] : []),
          "oidc-client-secret",
          ...(input.team.certificateFile
            ? ["application-cert.pem", "application-key.pem"]
            : []),
        ].map(
          (name) => `${join(privateDirectory, name)}:/run/clawscarf/${name}:ro`,
        ),
        ports: [
          `${input.team.certificateFile ? "0.0.0.0" : "127.0.0.1"}:${String(input.ports.application)}:18800`,
          `127.0.0.1:${String(input.ports.management)}:18801`,
          `${input.team.certificateFile ? "0.0.0.0" : "127.0.0.1"}:${String(input.ports.widgets)}:18800`,
        ],
        read_only: true,
        tmpfs: ["/tmp"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        init: true,
        depends_on: { postgres: { condition: "service_healthy" } },
        labels,
      },
    },
    secrets: {
      database_password: {
        file: join(privateDirectory, "database-admin-password"),
      },
    },
    networks: {
      ...(input.relayImage
        ? { runtime: { external: true, name: names.sandbox } }
        : {}),
      default: { external: true, name: `${names.project}_default` },
      ...(input.browser
        ? {
            browser: { external: true, name: `${names.project}_browser` },
            machine: { external: true, name: `${names.project}_machine` },
          }
        : {}),
    },
    volumes: {
      ...(input.modelGateway
        ? {
            "models-database": {
              external: true,
              name: `${names.project}-models`,
            },
          }
        : {}),
      database: { external: true, name: names.databaseVolume },
      ...(input.browser
        ? {
            browser: { external: true, name: names.browserVolume },
            ...browserNodeVolumes(state),
          }
        : {}),
    },
  };
  for (const service of Object.values(configuration.services))
    Object.assign(service, { restart: "unless-stopped", labels });
  return configuration;
}
export function compose(
  directory: string,
  args: readonly string[],
  timeout = 120_000,
) {
  return run(
    "docker",
    ["compose", "-f", join(directory, "compose.json"), ...args],
    { timeout },
  );
}
