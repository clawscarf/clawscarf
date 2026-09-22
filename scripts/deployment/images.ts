import components from "../../release/components.json" with { type: "json" };
import { LocalSetupError, run } from "./process.js";

/** Verify the runtime declares the packaged execution contract. */
export async function verifyRuntimeImage(
  image: string,
  command: typeof run = run,
) {
  const model = await command("docker", [
    "image",
    "inspect",
    "--format",
    '{{index .Config.Labels "io.clawscarf.execution-model"}}',
    image,
  ]);
  if (model.trim() !== "team-runtime")
    throw new LocalSetupError(
      "configuration_changed",
      "Use a runtime image built for the team-runtime execution model. The selected image has not declared that contract.",
    );
}

export async function verifyBrowserNodeImage(
  image: string,
  command: typeof run = run,
) {
  const contract = await command("docker", [
    "image",
    "inspect",
    "--format",
    '{{index .Config.Labels "io.clawscarf.browser-file-transfer"}}',
    image,
  ]);
  if (contract.trim() !== "shared-artifacts-v1")
    throw new LocalSetupError(
      "configuration_changed",
      "The browser controller image does not support shared download artifacts. Select a runtime release with browser file-transfer support.",
    );
}

export const liteLlmImage =
  "ghcr.io/berriai/litellm:v1.100.1@sha256:a3715fa7ad8387941ab697259bd2881d68931657247a41984f90fae6d11c62bf";

export const postgresImage =
  "postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";

export const openshellGatewayImage = components.openshell.gatewayImage;
