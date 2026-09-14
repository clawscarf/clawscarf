import { readConfiguration } from "./config.js";
import { composeAccess } from "./composition.js";
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path)
  throw Error("Set CLAWSCARF_ACCESS_CONFIG to the private configuration file.");
const config = await readConfiguration(path);
const app = await composeAccess(config);
app.ingress.server.listen(config.port, config.host);
if (config.managementTls)
  app.ingress.managementServer?.listen(
    config.managementTls.port,
    config.managementTls.host,
  );
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
