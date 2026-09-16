import { runServer } from "../process-lifecycle.js";
import { readCompanionConfiguration } from "./config.js";
import { composeCompanion } from "./composition.js";
const path = process.env.CLAWSCARF_COMPANION_CONFIG;
if (!path)
  throw Error(
    "Set CLAWSCARF_COMPANION_CONFIG to the private configuration file.",
  );
const config = await readCompanionConfiguration(path);
const app = await composeCompanion(config);
await runServer(
  [
    {
      server: app.ingress.server,
      port: config.access.port,
      host: config.access.host,
    },
    ...(config.access.managementTls && app.ingress.managementServer
      ? [
          {
            server: app.ingress.managementServer,
            ...config.access.managementTls,
          },
        ]
      : []),
  ],
  () => app.close(),
);
