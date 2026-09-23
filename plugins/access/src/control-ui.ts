import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { creditNotice } from "./credit-notice.js";
import { account as mountAccount } from "./account.js";
import { people as mountPeople } from "./people.js";
export default defineControlUiPlugin({
  id: "clawscarf-access",
  activate(host) {
    const credits = host.ui.registerAccessory({
      id: "cloud-credit-notice",
      placement: "session-header",
      mount: creditNotice,
    });
    const account = host.ui.registerPage({
      id: "account",
      label: "Account",
      mount: mountAccount,
    });
    const people = host.ui.registerPage({
      id: "people",
      label: "People",
      mount: mountPeople,
    });
    const accountNavigation = host.ui.registerNavigation({
      id: "account",
      label: "Account",
      icon: "user",
      page: { id: "account" },
      defaultVisible: true,
    });
    let peopleNavigation: (() => void) | undefined;
    const update = () => {
      if (host.connection.canAdmin && !peopleNavigation) {
        peopleNavigation = host.ui.registerNavigation({
          id: "people",
          label: "People",
          icon: "users",
          page: { id: "people" },
          defaultVisible: true,
        });
      } else if (!host.connection.canAdmin && peopleNavigation) {
        peopleNavigation();
        peopleNavigation = undefined;
      }
    };
    update();
    const unsubscribe = host.subscribe(update);
    return () => {
      unsubscribe();
      credits();
      peopleNavigation?.();
      accountNavigation();
      people();
      account();
    };
  },
});
