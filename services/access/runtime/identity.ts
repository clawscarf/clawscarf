import { readConfiguration } from "./config.js";
import { openAccessStorage } from "./storage.js";
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const storage = await openAccessStorage(await readConfiguration(path));
try {
  process.stdout.write(JSON.stringify(storage.identity, null, 2) + "\n");
} finally {
  await storage.close();
}
