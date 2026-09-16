import { configure, parseInput } from "./models.js";
import { ModelConfigurationError } from "./model-contract.js";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 1024 * 1024)
      throw new ModelConfigurationError("invalid_input");
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new ModelConfigurationError("invalid_input");
  }
  const state = await configure(parseInput(value), {
    stateDirectory: "/home/node/.openclaw",
    executable: "/app/clawscarf/bin/openclaw",
  });
  process.stdout.write(JSON.stringify({ ok: true, state }) + "\n");
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error:
        error instanceof ModelConfigurationError ? error.code : "invalid_state",
    }) + "\n",
  );
  process.exitCode = 1;
}
