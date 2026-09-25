import { defineFeatureContract } from "openclaw/plugin-sdk/feature-contract";
import { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
const plugin: ReturnType<typeof defineFeaturePlugin> = defineFeaturePlugin({
  contract: defineFeatureContract({
    pluginId: "clawscarf-access",
    operations: {},
    events: {},
  }),
  name: "People",
  description: "Account, team invitations and native role assignments.",
  setup: () => ({}),
});

export default plugin;
