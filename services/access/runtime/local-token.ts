import { readConfiguration } from "./config.js";
import { composeAccess } from "./composition.js";
import { hash, token } from "../service/session.js";
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const config = await readConfiguration(path);
if (config.identity.mode !== "local")
  throw Error("Local sign-in is unavailable in team mode.");
const app = await composeAccess(config);
try {
  const value = token();
  await app.repository.createLocalToken(hash(value));
  process.stdout.write(
    `Open ${config.origin}/_clawscarf/local-sign-in\nOne-use code (expires in five minutes): ${value}\n`,
  );
} finally {
  await app.close();
}
