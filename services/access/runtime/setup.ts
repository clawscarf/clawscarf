import { Command } from "commander";
import { readConfiguration } from "./config.js";
import { openAccessStorage } from "./storage.js";
import { hash, token } from "../service/session.js";

const { issue } = new Command("administrator-setup")
  .option("--issue", "Replace the private first-administrator setup link")
  .parse()
  .opts<{ issue?: boolean }>();
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const config = await readConfiguration(path);
const storage = await openAccessStorage(config);
try {
  let url: string | undefined;
  if (issue) {
    if (config.identity.mode !== "oidc")
      throw Error("Company login is not configured.");
    const value = token();
    await storage.repository.beginAdministratorSetup(hash(value));
    url = `${config.origin}/_clawscarf/login?setup=${encodeURIComponent(value)}&returnTo=${encodeURIComponent("/_clawscarf/setup-complete")}`;
  }
  process.stdout.write(
    JSON.stringify({
      ...(await storage.repository.administratorSetup()),
      ...(url ? { url } : {}),
    }) + "\n",
  );
} finally {
  await storage.close();
}
