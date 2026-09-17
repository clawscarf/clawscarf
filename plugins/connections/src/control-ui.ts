import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { connections } from "./connections-page.js";
export default defineControlUiPlugin({
  id: "clawscarf-connections",
  activate(host) {
    const page = host.ui.registerPage({
      id: "connections",
      label: "Connections",
      mount: connections,
    });
    let navigation: (() => void) | undefined;
    const update = () => {
      if (host.connection.canAdmin && !navigation)
        navigation = host.ui.registerNavigation({
          id: "connections",
          label: "Connections",
          icon: "plug",
          page: { id: "connections" },
          defaultVisible: true,
        });
      else if (!host.connection.canAdmin) {
        navigation?.();
        navigation = undefined;
      }
    };
    update();
    const unsubscribe = host.subscribe(update);
    return () => {
      unsubscribe();
      navigation?.();
      page();
    };
  },
});
