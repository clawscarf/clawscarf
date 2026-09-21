import { runServer } from "../process-lifecycle.js";
import { readConfiguration } from "../../services/access/runtime/config.js";
import { composeAccess } from "../../services/access/runtime/composition.js";
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path)
  throw Error("Set CLAWSCARF_ACCESS_CONFIG to the private configuration file.");
const config = await readConfiguration(path);
const app = await composeAccess(config);
await runServer(
  [
    { server: app.ingress.server, port: config.port, host: config.host },
    ...(config.managementTls && app.ingress.managementServer
      ? [{ server: app.ingress.managementServer, ...config.managementTls }]
      : []),
  ],
  () => app.close(),
);
