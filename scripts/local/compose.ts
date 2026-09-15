import { join } from "node:path";
import type { LocalState } from "./state.js";
import { resourceNames } from "./state.js";
import { run } from "./process.js";

// Exercised official Postgres 17 Alpine manifest; no mutable tag is used by setup.
export const postgresImage =
  "postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
export function composeConfiguration(state: LocalState, directory: string) {
  const { input, ownerId } = state;
  const names = resourceNames(state);
  const privateDirectory = join(directory, "private");
  const labels = { "clawscarf.installation": ownerId };
  return {
    name: names.project,
    services: {
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
        ].map(
          (name) => `${join(privateDirectory, name)}:/run/clawscarf/${name}:ro`,
        ),
        ports: [
          `127.0.0.1:${String(input.ports.application)}:18800`,
          `127.0.0.1:${String(input.ports.management)}:18801`,
          `127.0.0.1:${String(input.ports.widgets)}:18800`,
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
    volumes: { database: { external: true, name: names.databaseVolume } },
  };
}
export function compose(directory: string, args: readonly string[]) {
  return run(
    "docker",
    ["compose", "-f", join(directory, "compose.json"), ...args],
    { timeout: 120_000 },
  );
}
export async function ensureOwnedVolume(name: string, ownerId: string) {
  const listed = (
    await run("docker", ["volume", "ls", "--format", "{{.Name}}"])
  )
    .trim()
    .split("\n");
  if (!listed.includes(name))
    await run("docker", [
      "volume",
      "create",
      "--label",
      `clawscarf.installation=${ownerId}`,
      name,
    ]);
  const label = (
    await run("docker", [
      "volume",
      "inspect",
      name,
      "--format",
      '{{index .Labels "clawscarf.installation"}}',
    ])
  ).trim();
  if (label !== ownerId)
    throw Error("A volume with this name belongs to a different installation.");
}
