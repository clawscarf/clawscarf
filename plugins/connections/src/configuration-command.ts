import { configurationCommand } from "./configuration.ts";

// This private executable receives only non-secret configuration on stdin.
// SDK diagnostics are not forwarded across the management boundary.
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 64 * 1024) throw new Error("Input is too large.");
  }
  const value: unknown = JSON.parse(input);
  process.stdout.write(JSON.stringify(await configurationCommand(value)));
} catch {
  process.stdout.write(JSON.stringify({ error: "configuration_unavailable" }));
  process.exitCode = 1;
}
