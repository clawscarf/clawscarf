import type { ControlUiAccessory } from "openclaw/plugin-sdk/control-ui";
import * as api from "../../../services/cloud/management/generated/sdk.gen.js";
import { element, button } from "./page.js";

/** Native chat keeps its own errors; this accessory supplies the Cloud recovery destination. */
export const creditNotice: ControlUiAccessory["mount"] = (
  container,
  context,
) => {
  const notice = element("div");
  notice.setAttribute("role", "status");
  container.append(notice);
  let disposed = false,
    failed = false,
    revision = 0;
  let current = context;
  const request = {
    baseUrl: window.location.origin,
    credentials: "same-origin",
    throwOnError: true,
    signal: context.signal,
  } as const;
  async function update() {
    const ownRevision = ++revision;
    notice.replaceChildren();
    if (!failed || disposed || context.signal.aborted) return;
    try {
      const capabilities = (await api.getCloudCapabilities(request)).data;
      if (!capabilities.ai || disposed || ownRevision !== revision) return;
      let message =
        "ClawScarf Cloud AI: ask an installation administrator to check credits and service status in Account.";
      if (context.host.connection.canAdmin) {
        message =
          "ClawScarf Cloud AI: check credits and service status in Account.";
        const services = (
          await api.listCloudServices(request)
        ).data.services.filter((service) => service.ai);
        const balances = await Promise.all(
          services.map((service) =>
            api.getCloudAllowances({ ...request, path: { id: service.id } }),
          ),
        );
        if (balances.some((result) => result.data.ai.state === "exhausted"))
          message =
            "ClawScarf Cloud AI credits have run out. Open Account to review credits and any pending payment.";
        else if (balances.some((result) => result.data.ai.state === "pending"))
          message =
            "AI credit activation is pending. Check Account before paying again.";
      }
      if (disposed || ownRevision !== revision) return;
      notice.append(element("span", message));
      if (context.host.connection.canAdmin)
        notice.append(
          button("Open Account", () =>
            context.host.navigation.openPage({ id: "account" }),
          ),
        );
    } catch {
      if (!disposed && !context.signal.aborted && ownRevision === revision)
        notice.append(
          element(
            "span",
            "Cloud status could not be checked. Your installation administrator can retry from Account.",
          ),
        );
    }
  }
  const stop = context.host.onEvent("chat", (payload) => {
    if (
      typeof payload !== "object" ||
      !payload ||
      !("sessionKey" in payload) ||
      typeof payload.sessionKey !== "string" ||
      !("state" in payload)
    )
      return;
    if (
      context.host.sessions.normalizeKey(payload.sessionKey) !==
      context.host.sessions.normalizeKey(current.props.sessionKey)
    )
      return;
    if (payload.state === "error" || payload.state === "final") {
      failed = payload.state === "error";
      void update();
    }
  });
  let administrator = context.host.connection.canAdmin;
  const unsubscribe = context.host.subscribe(() => {
    if (administrator !== context.host.connection.canAdmin) {
      administrator = context.host.connection.canAdmin;
      if (failed) void update();
    }
  });
  return {
    update(next) {
      if (next.props.sessionKey !== current.props.sessionKey) {
        failed = false;
        revision++;
        notice.replaceChildren();
      }
      current = next;
    },
    dispose() {
      disposed = true;
      revision++;
      stop();
      unsubscribe();
      notice.remove();
    },
  };
};
