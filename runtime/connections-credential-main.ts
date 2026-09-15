import { loadConnectionsCredential } from "./connections-credential.js";

// stdout is a private pipe captured by the launcher, never an operator diagnostic.
try {
  const credential = await loadConnectionsCredential(
    process.env.OPENCLAW_STATE_DIR ?? "/home/node/.openclaw",
  );
  if (credential) process.stdout.write(credential.token);
} catch {
  process.stderr.write(
    "Cannot load the Connections runtime credential. Check its private credential and certificate files.\n",
  );
  process.exitCode = 1;
}
