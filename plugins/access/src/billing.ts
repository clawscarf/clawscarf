import type { ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import * as api from "../../../services/cloud/management/generated/sdk.gen.js";
import type {
  BillingAllowances,
  BillingOffer,
  BillingOrder,
  CloudAuthorization,
} from "../../../services/cloud/management/generated/types.gen.js";
import type { Page } from "../../common/native-page.js";
import { element, button, confirm, failure } from "./page.js";

const usd = (micros: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(micros / 1_000_000);
const rate = (micros: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
const count = (value: number) => new Intl.NumberFormat().format(value);
const terminal = new Set(["fulfilled", "expired", "failed"]);
type Intent = {
  requestId: string;
  offerId: string;
  quantity: 1;
  returnPath: string;
  orderId?: string;
};
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function readIntent(key: string): Intent | undefined {
  const value = sessionStorage.getItem(key);
  if (!value) return;
  let x: unknown;
  try {
    x = JSON.parse(value);
  } catch {
    throw Error(
      "The saved checkout cannot be read. Review purchase history before clearing this browser’s saved checkout.",
    );
  }
  if (
    typeof x !== "object" ||
    !x ||
    !("requestId" in x) ||
    typeof x.requestId !== "string" ||
    !uuid.test(x.requestId) ||
    !("offerId" in x) ||
    typeof x.offerId !== "string" ||
    !("returnPath" in x) ||
    typeof x.returnPath !== "string" ||
    !("quantity" in x) ||
    x.quantity !== 1
  )
    throw Error(
      "The saved checkout is invalid. Review purchase history before starting another payment.",
    );
  const orderId =
    "orderId" in x && typeof x.orderId === "string" && uuid.test(x.orderId)
      ? x.orderId
      : undefined;
  return {
    requestId: x.requestId,
    offerId: x.offerId,
    quantity: 1,
    returnPath: x.returnPath,
    ...(orderId ? { orderId } : {}),
  };
}
function stripeUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("Cloud returned an unexpected payment destination.");
  return url.href;
}
const stateCopy: Record<BillingAllowances["ai"]["state"], string> = {
  available: "Available",
  exhausted: "Out of credit",
  pending: "Credit activation pending",
  suspended: "Payments need attention",
  disabled: "Not enabled",
  unavailable: "Service temporarily unavailable",
};
const orderCopy: Record<BillingOrder["status"], string> = {
  creating: "Preparing checkout",
  checkout_ready: "Checkout is open; payment is not confirmed",
  payment_pending: "Payment is processing",
  paid: "Payment received; credits are being activated",
  fulfilled: "Credits added",
  expired: "Checkout expired without payment",
  failed: "Checkout failed",
  uncertain: "Payment status is not confirmed; check before paying again",
};

/** Account owns billing presentation; the companion owns authority and Stripe remains hosted. */
export async function mountBilling(
  view: Page,
  context: ControlUiViewContext,
  userId: string,
) {
  if (!context.host.connection.canAdmin) return () => {};
  const services = (await api.listCloudServices(view.request)).data.services;
  if (
    !services.length ||
    context.signal.aborted ||
    !context.host.connection.canAdmin
  )
    return () => {};
  const root = element("section");
  root.className = "clawscarf-cloud";
  const introduction = element("div");
  introduction.append(
    element("h3", "Cloud services"),
    element(
      "p",
      "Balances are shared across your Cloud account’s installations. Team login remains free and works when credits run out.",
    ),
  );
  root.append(introduction);
  view.content.append(root);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const usable = () =>
    !disposed && !context.signal.aborted && context.host.connection.canAdmin;
  const unsubscribe = context.host.subscribe(() => {
    if (!context.host.connection.canAdmin) {
      root.replaceChildren();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
  });
  function later(id: string, run: () => Promise<void>, seconds: number) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        if (usable())
          void view.run(run, "").then((ran) => {
            if (!ran && usable()) later(id, run, 2);
          });
      }, seconds * 1000),
    );
  }
  for (const service of services) {
    const target = element("section");
    target.className = "clawscarf-cloud-service";
    root.append(target);
    const key = `clawscarf-checkout:${userId}:${service.id}`;
    let allowance: BillingAllowances | undefined;
    let offers: BillingOffer[] = [];
    let purchasing = false;
    let authorization: CloudAuthorization | undefined;
    let order: BillingOrder | undefined;
    let error = "";
    let checkedAt = "";
    let pollCount = 0;
    const history = element("div");
    const modelPrices = element("div");
    let historyReviewed = false;
    const path = { id: service.id };
    const read = () => ({ ...view.request, path });
    const write = () => ({ ...view.write(), path });
    const returnPath = () => {
      const url = new URL(
        context.host.navigation.pageHref({ id: "account" }),
        window.location.origin,
      );
      if (url.origin !== window.location.origin)
        throw Error(
          "The Account return page must belong to this installation.",
        );
      return url.pathname + url.search;
    };
    async function load() {
      try {
        const [balances, pricing, auth] = await Promise.all([
          api.getCloudAllowances(read()),
          api.getCloudOffers(read()),
          api.getCloudAuthorization(read()),
        ]);
        if (!usable()) return;
        allowance = balances.data;
        offers = pricing.data.offers;
        purchasing = pricing.data.purchasingAvailable;
        authorization = auth.data;
        if (authorization.state !== "authorized") {
          history.replaceChildren();
          historyReviewed = false;
        }
        checkedAt = new Date().toLocaleTimeString();
        error = "";
        const intent = readIntent(key);
        if (intent?.orderId && authorization.state === "authorized") {
          order = (
            await api.getCloudOrder({
              ...read(),
              path: { ...path, orderId: intent.orderId },
            })
          ).data;
          if (terminal.has(order.status)) {
            sessionStorage.removeItem(key);
            allowance = (await api.getCloudAllowances(read())).data;
          } else if (
            ["creating", "payment_pending", "paid", "uncertain"].includes(
              order.status,
            ) &&
            pollCount++ < 60
          )
            later(service.id, load, 5);
        }
        render();
        if (authorization.state === "pending")
          later(service.id, poll, Math.max(authorization.pollAfterSeconds, 3));
      } catch (cause) {
        if (!usable()) return;
        error = failure(cause);
        await recoverAuthorization();
        render();
      }
    }
    async function recoverAuthorization() {
      if (!usable()) return;
      try {
        authorization = (await api.getCloudAuthorization(read())).data;
      } catch {
        authorization = undefined;
      }
      if (authorization?.state !== "authorized") {
        history.replaceChildren();
        historyReviewed = false;
      }
    }
    async function poll() {
      try {
        authorization = (
          await api.pollCloudAuthorization({ ...write(), body: {} })
        ).data;
        await load();
      } catch (cause) {
        await recoverAuthorization();
        render();
        throw cause;
      }
    }
    async function checkout(offerId: string) {
      let intent = readIntent(key);
      if (intent && intent.offerId !== offerId)
        throw Error(
          "A checkout is already in progress. Check that payment before choosing another pack.",
        );
      intent ??= {
        requestId: crypto.randomUUID(),
        offerId,
        quantity: 1,
        returnPath: returnPath(),
      };
      sessionStorage.setItem(key, JSON.stringify(intent));
      const result = (
        await api.createCloudCheckout({
          ...write(),
          body: {
            requestId: intent.requestId,
            offerId: intent.offerId,
            quantity: intent.quantity,
            returnPath: intent.returnPath,
          },
        })
      ).data;
      intent.orderId = result.orderId;
      sessionStorage.setItem(key, JSON.stringify(intent));
      if (result.checkoutUrl) {
        window.location.assign(stripeUrl(result.checkoutUrl));
        return;
      }
      await load();
    }
    function action(
      label: string,
      work: () => Promise<void>,
      progress: string,
    ) {
      const control = button(label, () => {
        void view.run(async () => {
          try {
            await work();
          } catch (cause) {
            await recoverAuthorization();
            render();
            throw cause;
          }
        }, progress);
      });
      control.dataset.focusId = service.id + ":" + label;
      return control;
    }
    function render() {
      if (!usable()) return;
      target.replaceChildren();
      const header = element("header");
      header.append(
        element("h4", services.length > 1 ? service.url : "ClawScarf Cloud"),
        action("Refresh", load, "Refreshing Cloud balances…"),
      );
      target.append(header);
      if (error) {
        const notice = element("p", error);
        notice.setAttribute("role", "alert");
        target.append(notice);
      }
      if (!allowance) {
        target.append(element("p", "Balances are unavailable."));
        return;
      }
      const paymentWaiting = Boolean(
        order &&
        !terminal.has(order.status) &&
        order.status !== "checkout_ready",
      );
      const balances = element("div");
      balances.className = "clawscarf-cloud-balances";
      if (service.ai) {
        const item = element("section");
        const balance = element("p", usd(allowance.ai.available));
        balance.className = "clawscarf-cloud-amount";
        item.append(
          element("h4", "AI credits"),
          balance,
          element("small", stateCopy[allowance.ai.state] + " · USD credit"),
        );
        if (allowance.ai.state === "exhausted")
          item.append(
            element(
              "p",
              paymentWaiting && order?.service === "ai"
                ? "A payment is pending. Check its status below before buying more credits."
                : "AI credits have run out. Add credits to resume requests.",
            ),
          );
        else if (allowance.ai.state === "pending")
          item.append(
            element(
              "p",
              "Credits are being activated. A confirmed payment does not need to be repeated.",
            ),
          );
        else if (allowance.ai.state === "suspended")
          item.append(
            element(
              "p",
              "Resolve the payment issue before buying more AI credit.",
            ),
          );
        if (allowance.ai.usageAsOf)
          item.append(
            element(
              "small",
              "Usage updated " +
                new Date(allowance.ai.usageAsOf).toLocaleString(),
            ),
          );
        balances.append(item);
      }
      if (service.connections) {
        const item = element("section");
        const balance = element("p", count(allowance.connections.available));
        balance.className = "clawscarf-cloud-amount";
        item.append(
          element("h4", "Connections"),
          balance,
          element("small", "Actions available"),
          element(
            "small",
            count(allowance.connections.freeRemaining) +
              " daily allowance remaining · " +
              count(allowance.connections.paidRemaining) +
              " prepaid",
          ),
        );
        if (allowance.connections.resetsAt)
          item.append(
            element(
              "small",
              "Daily allowance resets " +
                new Date(allowance.connections.resetsAt).toLocaleString(),
            ),
          );
        if (allowance.connections.state === "exhausted")
          item.append(
            element(
              "p",
              paymentWaiting && order?.service === "connections"
                ? "A payment is pending. Check its status below before buying another pack."
                : "The Connections allowance has run out. Buy an actions pack or wait for the daily reset.",
            ),
          );
        else if (allowance.connections.state !== "available")
          item.append(element("p", stateCopy[allowance.connections.state]));
        item.append(
          element(
            "small",
            "One action is one connector execution. AI credits are separate.",
          ),
        );
        balances.append(item);
      }
      target.append(balances, element("small", "Last checked " + checkedAt));
      const payment = element("section");
      payment.className = "clawscarf-cloud-payment";
      payment.append(element("h4", "Add credits and actions"));
      const authorized = authorization?.state === "authorized";
      if (!authorized) {
        payment.append(
          element(
            "p",
            "Installation administrators can view usage. Only this Cloud account’s owner can purchase or manage payments.",
          ),
        );
        if (authorization?.state === "pending" && authorization.url) {
          const url = new URL(authorization.url);
          if (url.origin !== service.url)
            throw Error("Unexpected Cloud sign-in destination.");
          const link = element("a", "Continue to Cloud sign-in");
          link.className = "btn";
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          payment.append(
            link,
            element("p", "Approval code: " + authorization.code),
            element(
              "small",
              "Check that this code matches the Cloud sign-in page. Waiting for approval…",
            ),
            action("Check sign-in", poll, "Checking billing sign-in…"),
            action(
              "Cancel sign-in",
              async () => {
                await api.forgetCloudAuthorization(write());
                await load();
              },
              "Cancelling billing sign-in…",
            ),
          );
        } else
          payment.append(
            action(
              "Sign in to manage billing",
              async () => {
                authorization = (
                  await api.startCloudAuthorization({ ...write(), body: {} })
                ).data;
                await load();
              },
              "Preparing Cloud owner sign-in…",
            ),
          );
      } else {
        payment.append(
          element(
            "p",
            "Cloud owner verified. Purchases are one-time; there is no automatic recharge.",
          ),
          action(
            "Disconnect billing sign-in",
            async () => {
              await api.forgetCloudAuthorization(write());
              await load();
            },
            "Disconnecting billing sign-in…",
          ),
        );
      }
      if (!purchasing)
        payment.append(
          element(
            "p",
            "New purchases are temporarily unavailable. Existing balances remain visible.",
          ),
        );
      let pending: Intent | undefined;
      let invalidIntent = false;
      try {
        pending = readIntent(key);
      } catch {
        invalidIntent = true;
        if (!error)
          payment.append(
            element(
              "p",
              "The saved checkout cannot be read. Review purchase history before clearing this browser’s saved checkout.",
            ),
          );
      }

      const availableOffers = offers.filter(
        (offer) =>
          (offer.service === "ai" ? service.ai : service.connections) &&
          offer.maxQuantity > 0,
      );
      const packGroups = new Map<string, HTMLElement>();
      for (const offer of availableOffers) {
        let group = packGroups.get(offer.service);
        if (!group) {
          group = element("div");
          group.className = "clawscarf-cloud-packs";
          group.append(
            element(
              "h5",
              offer.service === "ai" ? "AI credit packs" : "Connections packs",
            ),
          );
          packGroups.set(offer.service, group);
          payment.append(group);
        }
        const amount =
          offer.service === "ai"
            ? usd(offer.amount) + " AI credit"
            : count(offer.amount) + " Connections actions";
        const price = usd(offer.priceMinor * 10_000);
        const buy = action(
          `${pending?.offerId === offer.id && !paymentWaiting ? "Resume checkout for" : "Buy"} ${amount}`,
          () => checkout(offer.id),
          "Preparing secure checkout…",
        );
        buy.append(element("small", `${price} + tax`));
        buy.disabled =
          invalidIntent ||
          Boolean(error) ||
          !authorized ||
          !purchasing ||
          !["available", "exhausted"].includes(
            allowance[offer.service].state,
          ) ||
          paymentWaiting ||
          Boolean(pending && pending.offerId !== offer.id);
        group.append(buy);
      }
      if (
        pending &&
        !availableOffers.some((offer) => offer.id === pending.offerId)
      ) {
        const savedOfferId = pending.offerId;
        const resume = action(
          "Resume saved checkout",
          () => checkout(savedOfferId),
          "Checking saved checkout…",
        );
        resume.disabled = !authorized || paymentWaiting;
        payment.append(resume);
      }
      payment.append(
        element(
          "small",
          "Prices are in USD, before applicable tax. Purchased credits and packs do not expire. Card details are entered on Stripe.",
        ),
      );
      if (pending && !order)
        payment.append(
          element(
            "p",
            "A checkout request is saved. Resume that checkout to confirm its status; it will not create a duplicate order.",
          ),
        );
      if (order) {
        const status = element("p", orderCopy[order.status]);
        status.setAttribute("role", "status");
        payment.append(status);
        if (order.status === "checkout_ready" && pending)
          payment.append(
            button("Choose a different pack", () => {
              confirm(
                view,
                "Start a different checkout",
                "The previous checkout may still be open. Check that you have not paid it before starting another purchase.",
                async () => {
                  sessionStorage.removeItem(key);
                  order = undefined;
                  await load();
                },
              );
            }),
          );
      }
      if (authorized)
        payment.append(
          action(
            "Payment details on Stripe",
            async () => {
              const result = (
                await api.createCloudPortal({
                  ...write(),
                  body: {
                    requestId: crypto.randomUUID(),
                    returnPath: returnPath(),
                  },
                })
              ).data;
              window.location.assign(stripeUrl(result.url));
            },
            "Opening Stripe billing…",
          ),
        );
      if (authorized)
        payment.append(
          action(
            "Purchase history",
            async () => {
              const result = (await api.listCloudOrders(read())).data;
              const rows = element("div");
              for (const purchase of result.orders)
                rows.append(
                  element(
                    "p",
                    new Date(purchase.createdAt).toLocaleString() +
                      " · " +
                      purchase.service +
                      " · " +
                      usd(purchase.amountMinor * 10_000) +
                      " · " +
                      orderCopy[purchase.status] +
                      (purchase.refundedMinor
                        ? " · Refunded " + usd(purchase.refundedMinor * 10_000)
                        : "") +
                      (purchase.disputedMinor
                        ? " · Disputed " + usd(purchase.disputedMinor * 10_000)
                        : ""),
                  ),
                );
              if (!result.orders.length)
                rows.append(element("p", "No purchases yet."));
              history.replaceChildren(rows);
              historyReviewed = true;
              render();
            },
            "Loading recent purchases…",
          ),
        );
      if (authorized && invalidIntent && historyReviewed)
        payment.append(
          button("Clear unreadable checkout", () => {
            confirm(
              view,
              "Clear saved checkout",
              "Check your recent purchases before continuing. This only clears this browser’s saved request; it does not cancel a Stripe checkout or refund a payment. Do not buy again if a payment is still processing.",
              async () => {
                sessionStorage.removeItem(key);
                order = undefined;
                await load();
              },
            );
          }),
        );
      payment.append(history);
      target.append(payment);
      if (service.ai)
        target.append(
          action(
            "View model prices",
            async () => {
              const result = (await api.getCloudModels(read())).data;
              const table = element("table");
              const heading = element("tr");
              for (const label of [
                "Model",
                "Input / 1M tokens",
                "Output / 1M tokens",
              ]) {
                const cell = element("th", label);
                cell.scope = "col";
                heading.append(cell);
              }
              const head = element("thead");
              head.append(heading);
              table.append(head);
              const body = element("tbody");
              for (const model of result.models) {
                const row = element("tr");
                row.append(
                  element("td", model.name),
                  element("td", rate(model.inputMicrosPerMillion)),
                  element("td", rate(model.outputMicrosPerMillion)),
                );
                body.append(row);
              }
              table.append(body);
              const detail = element("div");
              detail.append(
                element(
                  "p",
                  "Indicative Cloud rates, including markup and before tax. Actual credit use follows provider-reported usage, which can include additional costs.",
                ),
                table,
              );
              modelPrices.replaceChildren(detail);
            },
            "Loading current model prices…",
          ),
          modelPrices,
        );
    }
    await load();
  }
  return () => {
    disposed = true;
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
    root.remove();
  };
}
