import { join } from "node:path";
import { openshellGatewayImage } from "./images.js";
import { resourceNames, type LocalState } from "./state.js";

/** OpenShell alone receives Docker authority. Forwarders receive only client credentials. */
export function controllerServices(
  directory: string,
  state: LocalState,
  address: string,
) {
  const controller = join(directory, "controller");
  const { input } = state;
  const name = resourceNames(state).sandbox;
  const port = input.ports.controller;
  const forward = (target: string, port: number) => ({
    image: input.openshellClientImage,
    init: true,
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    tmpfs: ["/tmp"],
    environment: {
      HOME: "/tmp",
      XDG_CONFIG_HOME: "/controller/config",
      XDG_STATE_HOME: "/tmp/state",
      XDG_DATA_HOME: "/tmp/data",
    },
    volumes: [`${join(controller, "config")}:/controller/config:ro`],
    command: [
      "forward",
      "start",
      `0.0.0.0:${String(port)}`,
      target,
      "--gateway",
      name,
      "--gateway-endpoint",
      `https://controller.clawscarf.internal:${String(input.ports.controller)}`,
    ],
    ports: [`127.0.0.1:${String(port)}:${String(port)}`],
  });
  return {
    controller: {
      image: openshellGatewayImage,
      user: "0:0",
      networks: {
        default: { aliases: ["controller.clawscarf.internal"] },
        runtime: { ipv4_address: address },
      },
      command: ["--config", join(controller, "gateway.toml")],
      environment: {
        XDG_CONFIG_HOME: join(controller, "config"),
        XDG_STATE_HOME: join(controller, "state"),
        XDG_DATA_HOME: join(controller, "data"),
        HOME: controller,
      },
      // Identical paths are required: Docker resolves sandbox mounts on its host.
      volumes: [
        `${controller}:${controller}`,
        "/var/run/docker.sock:/var/run/docker.sock",
      ],
      ports: [`127.0.0.1:${String(port)}:${String(port)}`],
    },
    application: forward(name, input.ports.native),
    widgets: forward(name, input.ports.nativeWidgets),
  };
}
