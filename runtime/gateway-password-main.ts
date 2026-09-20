import { gatewayPassword } from "./gateway-password.js";

// stdout is captured privately by the launcher; never print this as a diagnostic.
try {
  const password = await gatewayPassword(
    process.env.OPENCLAW_STATE_DIR ?? "/home/node/.openclaw",
    process.argv[2] === "gateway" &&
      ["", "run"].includes(process.argv[3] ?? ""),
  );
  if (password) process.stdout.write(password);
} catch {
  process.stderr.write("Cannot load the private local Gateway credential.\n");
  process.exitCode = 1;
}
