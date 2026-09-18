import { connectionsConfigurationResultSchema } from "../../runtime/connections-configuration.js";
import { resourceNames, type LocalState } from "./state.js";
import { run } from "./process.js";

/** Caller holds the installation lock and has verified the stopped, owned native volume. */
export async function configureConnectionsVolume(
  state: LocalState,
  request: import("../../runtime/connections-configuration.js").ConnectionsConfigurationInput,
  command: typeof run = run,
) {
  const names = resourceNames(state);
  return connectionsConfigurationResultSchema.parse(
    JSON.parse(
      await command(
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "--pull",
          "never",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--user",
          "1000:1000",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=64m",
          "--mount",
          `type=volume,source=${names.volume},target=/home/node,volume-nocopy${request.kind === "observe" ? ",readonly" : ""}`,
          "--entrypoint",
          "node",
          state.input.runtimeImage,
          "/app/clawscarf/configure-connections-main.js",
        ],
        { input: JSON.stringify(request), timeout: 60_000 },
      ),
    ),
  );
}
