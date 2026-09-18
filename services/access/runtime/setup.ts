import { OpenClawAuthority } from "../providers/native.js";
import { Command } from "commander";
import { readConfiguration } from "./config.js";
import { openAccessStorage } from "./storage.js";
import { hash, token } from "../service/session.js";

const { issue, verify } = new Command("administrator-setup")
  .option("--issue", "Replace the private first-administrator setup link")
  .option("--verify", "Verify the selected administrator in OpenClaw")
  .parse()
  .opts<{ issue?: boolean; verify?: boolean }>();
const path = process.env.CLAWSCARF_ACCESS_CONFIG;
if (!path) throw Error("Set CLAWSCARF_ACCESS_CONFIG.");
const config = await readConfiguration(path);
const storage = await openAccessStorage(config);
try {
  let url: string | undefined;
  if (verify && (await storage.repository.administratorSetup()).complete) {
    const person = storage.identity.administrator;
    const credential = token(),
      digest = hash(credential);
    await storage.repository.createSession(person.id, digest, token(), null);
    try {
      const native = new OpenClawAuthority(
        config.origin,
        config.runtime.managementOrigin
          ? { endpoint: config.runtime.managementOrigin }
          : {},
      );
      const actor = {
        identity: person.identity,
        email: person.email,
        sessionHash: digest,
      };
      await native.verifyAdministrator(actor, credential);
      await native.prepareTeam(actor, credential);
    } finally {
      await storage.repository.revokeSession(digest);
    }
  }
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
