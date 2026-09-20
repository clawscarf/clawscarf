import { join } from "node:path";
import type { LocalState } from "./state.js";
import { postgresImage } from "./images.js";

export function modelGatewayServices(directory: string, state: LocalState) {
  const input = state.input.modelGateway;
  if (!input) return {};
  const root = join(directory, "private/models");
  const labels = { "clawscarf.installation": state.ownerId };
  return {
    "models-database": {
      image: postgresImage,
      environment: {
        POSTGRES_DB: "models",
        POSTGRES_USER: "models",
        POSTGRES_PASSWORD_FILE: "/run/secrets/password",
      },
      volumes: [
        "models-database:/var/lib/postgresql/data",
        `${join(root, "database-password")}:/run/secrets/password:ro`,
      ],
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U models -d models"],
        interval: "2s",
        timeout: "3s",
        retries: 30,
      },
      labels,
    },
    models: {
      image: input.image,
      user: `${String(process.getuid?.() ?? 1000)}:${String(process.getgid?.() ?? 1000)}`,
      environment: { HOME: "/tmp" },
      networks: {
        default: {},
        runtime: { aliases: ["models.clawscarf.internal"] },
      },
      init: true,
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      tmpfs: ["/tmp:size=256m,mode=1777"],
      command: [
        "--config",
        "/etc/clawscarf/models.json",
        "--host",
        "0.0.0.0",
        "--port",
        "4000",
        "--ssl_keyfile_path",
        "/run/clawscarf/key.pem",
        "--ssl_certfile_path",
        "/run/clawscarf/cert.pem",
      ],
      env_file: [{ path: join(root, "gateway.env"), format: "raw" }],
      volumes: [
        `${join(root, "models.json")}:/etc/clawscarf/models.json:ro`,
        `${join(directory, "private/management-key.pem")}:/run/clawscarf/key.pem:ro`,
        `${join(directory, "private/management-cert.pem")}:/run/clawscarf/cert.pem:ro`,
      ],
      ports: [`127.0.0.1:${String(input.port)}:4000`],
      depends_on: { "models-database": { condition: "service_healthy" } },
      healthcheck: {
        test: [
          "CMD",
          "python",
          "-c",
          "import ssl,urllib.request; urllib.request.urlopen('https://127.0.0.1:4000/health/liveliness',context=ssl.create_default_context(cafile='/run/clawscarf/cert.pem'),timeout=3)",
        ],
        interval: "3s",
        timeout: "5s",
        retries: 40,
      },
      logging: {
        driver: "json-file",
        options: { "max-size": "10m", "max-file": "3" },
      },
      labels,
    },
  };
}
