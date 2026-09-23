import { registerCloudManagement } from "../../services/cloud/management/http.js";
import { registerCloudConnections } from "../../services/connections/cloud/http.js";
import { composeAccess } from "../../services/access/runtime/composition.js";
import type { NativeAuthority } from "../../services/access/types/native.js";
import type { CompanionConfiguration } from "./config.js";

/** Access owns entry; the optional adapter proves native authority before cloud requests. */
export function composeCompanion(
  config: CompanionConfiguration,
  adapters: { native?: NativeAuthority } = {},
) {
  return composeAccess(
    config.access,
    async (http, access, native) => {
      await registerCloudManagement(http, {
        services: config.cloudServices ?? [],
        origin: config.access.origin,
        access,
        native,
      });
      if (config.cloudConnections)
        await registerCloudConnections(http, {
          ...config.cloudConnections,
          origin: config.access.origin,
          access,
          native,
        });
    },
    adapters,
  );
}
