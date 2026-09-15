import { runtimeTrust } from "./trust.js";

try {
  process.stdout.write(
    await runtimeTrust(
      process.env.OPENCLAW_STATE_DIR ?? "/home/node/.openclaw",
      process.env.NODE_EXTRA_CA_CERTS,
    ),
  );
} catch {
  process.stderr.write(
    "Cannot prepare runtime CA trust. Check the configured certificate files.\n",
  );
  process.exitCode = 1;
}
