import { readState } from "../../scripts/deployment/state.js";
import { ensureRuntime } from "../../scripts/deployment/runtime.js";
import { run } from "../../scripts/deployment/process.js";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw Error("An isolated prepared installation is required.");
const state = await readState(directory);
const controller = join(directory, "controller");
await ensureRuntime(
  directory,
  state,
  {
    ...process.env,
    XDG_CONFIG_HOME: join(controller, "config"),
    XDG_STATE_HOME: join(controller, "state"),
    XDG_DATA_HOME: join(controller, "data"),
  },
  async (executable, args, options) => {
    const result = await run(executable, args, options);
    if (args[0] === "sandbox" && args[1] === "create") {
      // The real controller has allocated; the parent process dies before any receipt is saved.
      process.kill(process.pid, "SIGKILL");
      await new Promise<never>(() => undefined);
    }
    return result;
  },
);
throw Error("The allocation fixture did not reach its crash boundary.");
