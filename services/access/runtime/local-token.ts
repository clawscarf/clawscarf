import { readConfiguration } from "./config.js";
import { openAccessStorage } from "./storage.js";
import { hash, token } from "../service/session.js";
import { Command } from "commander";
const options = new Command("clawscarf-local-token")
  .option("--json", "Return the sign-in URL and one-use code as JSON")
  .option("--status <hash>", "Observe completion of a previously issued login")
  .parse()
  .opts<{ json?: boolean; status?: string }>();
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const config = await readConfiguration(path);
if (config.identity.mode !== "local")
  throw Error("Local sign-in is unavailable in team mode.");
const storage = await openAccessStorage(config);
try {
  if (options.status) {
    process.stdout.write(
      JSON.stringify(
        await storage.repository.localTokenStatus(options.status),
      ) + "\n",
    );
  } else {
    const value = token();
    await storage.repository.createLocalToken(hash(value));
    const { expiresAt } = await storage.repository.localTokenStatus(
      hash(value),
    );
    const url = `${config.origin}/_clawscarf/local-sign-in#code=${value}`;
    process.stdout.write(
      options.json
        ? JSON.stringify({ url, code: value, expiresAt }) + "\n"
        : `Open ${url}\nExpires in five minutes.\n`,
    );
  }
} finally {
  await storage.close();
}
