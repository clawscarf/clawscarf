import { readConfiguration } from "./config.js";
import { openAccessStorage } from "./storage.js";
import { hash, token } from "../service/session.js";
import { Command } from "commander";
const options = new Command("clawscarf-local-token")
  .option("--json", "Return the sign-in URL and one-use code as JSON")
  .parse()
  .opts<{ json?: boolean }>();
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const config = await readConfiguration(path);
if (config.identity.mode !== "local")
  throw Error("Local sign-in is unavailable in team mode.");
const storage = await openAccessStorage(config);
try {
  const value = token();
  await storage.repository.createLocalToken(hash(value));
  const url = `${config.origin}/_clawscarf/local-sign-in`;
  process.stdout.write(
    options.json
      ? JSON.stringify({ url, code: value }) + "\n"
      : `Open ${url}\nOne-use code (expires in five minutes): ${value}\n`,
  );
} finally {
  await storage.close();
}
