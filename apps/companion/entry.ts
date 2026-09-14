import { once } from "node:events";
import { readCompanionConfiguration } from "./config.js";
import { composeCompanion } from "./composition.js";
const path = process.env.CLAWSCARF_COMPANION_CONFIG;
if (!path)
  throw Error(
    "Set CLAWSCARF_COMPANION_CONFIG to the private configuration file.",
  );
const config = await readCompanionConfiguration(path);
const app = await composeCompanion(config);
try {
  app.ingress.server.listen(config.access.port, config.access.host);
  await once(app.ingress.server, "listening");
  if (config.access.managementTls && app.ingress.managementServer) {
    app.ingress.managementServer.listen(
      config.access.managementTls.port,
      config.access.managementTls.host,
    );
    await once(app.ingress.managementServer, "listening");
  }
} catch (error) {
  await app.close();
  throw error;
}
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
