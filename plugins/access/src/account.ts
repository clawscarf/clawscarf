import { mountBilling } from "./billing.js";
import type { ControlUiView } from "openclaw/plugin-sdk/control-ui";
import * as api from "../../../services/access/generated/sdk.gen.js";
import { page, element, button } from "./page.js";
export const account: ControlUiView = (container, context) => {
  const view = page(container, context, "Account");
  let disposed = false;
  let disposeBilling: (() => void) | undefined;
  void view.run(async () => {
    const current = await view.session();
    view.content.append(
      element("h3", current.user.name),
      element("p", current.user.email),
    );
    view.content.append(
      button("Sign out", () => {
        void view.run(async () => {
          const result = await api.logout(view.write());
          window.location.assign(result.data.redirect);
        }, "Signing out…");
      }),
    );
    disposeBilling = await mountBilling(view, context, current.user.id);
    if (disposed) disposeBilling();
  }, "Loading account…");
  return {
    dispose: () => {
      disposed = true;
      disposeBilling?.();
      view.dispose();
    },
  };
};
