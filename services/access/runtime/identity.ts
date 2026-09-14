import { readConfiguration } from "./config.js";
import { composeAccess } from "./composition.js";
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const app = await composeAccess(await readConfiguration(path));
try {
  process.stdout.write(JSON.stringify(app.identity, null, 2) + "\n");
} finally {
  await app.close();
}
