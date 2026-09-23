import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { createClient } from "../../generated/http/client/index.js";
import * as api from "../../services/cloud/generated/sdk.gen.js";
import { readInputFile } from "../installation/files.js";
import { writePrivate } from "../deployment/state.js";
import { InstallationError } from "../installation/errors.js";
import type { CloudAiSession } from "./ai.js";

const integer = z.number().int().nonnegative();
const offerSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  service: z.enum(["ai", "connections"]),
  currency: z.literal("usd"),
  priceMinor: integer,
  amount: integer,
  maxQuantity: integer.positive(),
  purchaseType: z.literal("one_time"),
  taxBehavior: z.literal("exclusive"),
  unit: z.enum(["usd_micros", "executions"]),
});
const stateSchema = z.enum([
  "disabled",
  "pending",
  "available",
  "exhausted",
  "suspended",
  "unavailable",
]);
const orderSchema = z.object({
  id: z.uuid(),
  installationId: z.uuid(),
  service: z.literal("ai"),
  offerId: z.string(),
  status: z.enum([
    "creating",
    "checkout_ready",
    "payment_pending",
    "paid",
    "fulfilled",
    "expired",
    "failed",
    "uncertain",
  ]),
  refundedMinor: integer,
  disputedMinor: integer,
});
const intentSchema = z.strictObject({
  url: z.url(),
  accountId: z.uuid(),
  installationId: z.uuid(),
  requestId: z.uuid(),
  offerId: z.string().min(1),
  returnId: z.uuid().optional(),
  orderId: z.uuid().optional(),
});
export type AiFundingView = {
  state: z.infer<typeof stateSchema>;
  offers: z.infer<typeof offerSchema>[];
  order?: z.infer<typeof orderSchema>;
  savedOfferId?: string;
};
export type AiFundingOptions = {
  aiCreditOffer?: string;
  allowUnfundedAi?: boolean;
};
export class AiFundingRequired extends Error {
  constructor(readonly action: AiFundingView & { checkoutUrl?: string }) {
    super(
      "Cloud AI needs attention. Resume this setup to check payment, change AI setup or explicitly add credits later.",
    );
  }
}

/** One durable purchase intent per installation. Stripe credentials never enter the CLI. */
export class CloudAiBilling {
  private readonly client;
  private readonly file;
  private intent: z.infer<typeof intentSchema> | undefined;
  private fulfilled = false;
  constructor(private readonly session: CloudAiSession) {
    this.client = createClient({ baseUrl: session.url, redirect: "error" });
    this.file = session.registrationFile + ".billing.json";
  }
  private request(signal?: AbortSignal) {
    return {
      client: this.client,
      headers: { authorization: `Bearer ${this.session.authorization}` },
      signal: AbortSignal.any([
        AbortSignal.timeout(15000),
        ...(signal ? [signal] : []),
      ]),
    };
  }
  private async required<T>(
    result: { data?: T; response?: Response },
    message: string,
  ): Promise<T> {
    if (result.response?.status === 401)
      await rm(this.session.registrationFile + ".login", { force: true });
    if (!result.data) throw new InstallationError("unavailable", message);
    return result.data;
  }
  async load() {
    try {
      this.intent = intentSchema.parse(
        JSON.parse((await readInputFile(this.file, true)).toString("utf8")),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (
      this.intent &&
      (this.intent.url !== this.session.url ||
        this.intent.accountId !== this.session.accountId ||
        this.intent.installationId !== this.session.installationId)
    )
      throw new InstallationError(
        "invalid_configuration",
        "The saved purchase belongs to another Cloud installation. Restore its original settings before resuming payment.",
      );
  }
  async view(signal?: AbortSignal): Promise<AiFundingView> {
    const allowances = z
      .object({ ai: z.object({ state: stateSchema, available: integer }) })
      .parse(
        await this.required(
          await api.getInstallationAllowances({
            ...this.request(signal),
            path: { id: this.session.installationId },
          }),
          "Cloud AI status is unavailable. Check this setup again before purchasing.",
        ),
      );
    let order: z.infer<typeof orderSchema> | undefined;
    if (this.intent?.orderId) {
      order = orderSchema.parse(
        await this.required(
          await api.getBillingOrder({
            ...this.request(signal),
            path: { orderId: this.intent.orderId },
          }),
          "The saved payment could not be checked. Resume this setup before purchasing again.",
        ),
      );
      if (
        order.installationId !== this.session.installationId ||
        order.offerId !== this.intent.offerId
      )
        throw new InstallationError(
          "invalid_configuration",
          "The payment does not match this installation's saved purchase.",
        );
      this.fulfilled = order.status === "fulfilled";
      if (["expired", "failed"].includes(order.status)) {
        await rm(this.file, { force: true });
        this.intent = undefined;
      }
    }
    if (allowances.ai.state === "available" && !this.intent)
      return { state: "available", offers: [] };
    const offers = z
      .object({
        purchasingAvailable: z.boolean(),
        offers: z.array(offerSchema),
      })
      .parse(
        await this.required(
          await api.getBillingOffers(this.request(signal)),
          "Cloud purchase options are unavailable. Try again later or change AI setup.",
        ),
      );
    return {
      state: allowances.ai.state,
      offers: offers.purchasingAvailable
        ? offers.offers.filter(
            (offer) => offer.service === "ai" && offer.unit === "usd_micros",
          )
        : [],
      ...(order ? { order } : {}),
      ...(this.intent && !this.fulfilled
        ? { savedOfferId: this.intent.offerId }
        : {}),
    };
  }
  async checkout(offerId: string, signal?: AbortSignal, newPurchase = false) {
    if (this.fulfilled && newPurchase) {
      this.intent = undefined;
      this.fulfilled = false;
    }
    if (this.intent && this.intent.offerId !== offerId)
      throw new InstallationError(
        "invalid_configuration",
        "A purchase is already saved. Check or resume it before choosing another pack.",
      );
    this.intent ??= {
      url: this.session.url,
      accountId: this.session.accountId,
      installationId: this.session.installationId,
      requestId: randomUUID(),
      offerId,
    };
    const persist = () => writePrivate(this.file, JSON.stringify(this.intent));
    await persist();
    {
      const returned = z.object({ returnId: z.uuid() }).parse(
        await this.required(
          await api.createBillingReturn({
            ...this.request(signal),
            path: { id: this.session.installationId },
            body: { requestId: this.intent.requestId, path: null },
          }),
          "The checkout return could not be prepared. Resume this setup; the same purchase request will be reused.",
        ),
      );
      this.intent.returnId = returned.returnId;
      await persist();
    }
    const checkout = z
      .object({ orderId: z.uuid(), checkoutUrl: z.url().nullable() })
      .parse(
        await this.required(
          await api.createBillingCheckout({
            ...this.request(signal),
            body: {
              requestId: this.intent.requestId,
              offerId,
              quantity: 1,
              installationId: this.session.installationId,
              returnId: this.intent.returnId,
            },
          }),
          "Checkout was not confirmed. Resume this setup to check the saved purchase; do not start another payment.",
        ),
      );
    this.intent.orderId = checkout.orderId;
    await persist();
    if (checkout.checkoutUrl) {
      const url = new URL(checkout.checkoutUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "checkout.stripe.com" ||
        url.port ||
        url.username ||
        url.password
      )
        throw new InstallationError(
          "unavailable",
          "Cloud returned an unexpected checkout destination.",
        );
    }
    return checkout.checkoutUrl;
  }
  async wait(signal: AbortSignal) {
    const deadline = Date.now() + 55000;
    for (;;) {
      signal.throwIfAborted();
      const view = await this.view(signal);
      if (
        (view.state === "available" && !view.savedOfferId) ||
        ["expired", "failed"].includes(view.order?.status ?? "") ||
        Date.now() >= deadline
      )
        return view;
      await delay(3000, undefined, { signal });
    }
  }
}

export async function withCloudAiBilling<T>(
  session: CloudAiSession,
  work: (billing: CloudAiBilling) => Promise<T>,
) {
  const unlock = await lockfile.lock(dirname(session.registrationFile), {
    lockfilePath: session.registrationFile + ".billing.lock",
    retries: 0,
  });
  try {
    const billing = new CloudAiBilling(session);
    await billing.load();
    return await work(billing);
  } finally {
    await unlock();
  }
}
