import {
  configureRuntimeConnections,
  ConnectionsConfigurationError,
} from "./configure-connections.js";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 2 * 1024 * 1024)
      throw new Error("Input exceeds its limit.");
  }
  const result = await configureRuntimeConnections(
    "/home/node",
    JSON.parse(input),
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error:
        error instanceof ConnectionsConfigurationError
          ? error.code
          : "connections_configuration_invalid",
    }) + "\n",
  );
  process.exitCode = 1;
}
