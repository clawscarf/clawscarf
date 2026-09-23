import { rm } from "node:fs/promises";
import type { CloudAiSession } from "../../cloud/ai.js";
import {
  AiFundingRequired,
  withCloudAiBilling,
  type AiFundingOptions,
} from "../../cloud/billing.js";
import { InstallationError } from "../errors.js";
import {
  SectionCancelled,
  terminalLink,
  type InstallerPrompts,
  type progress,
} from "./prompts.js";
import { dirname } from "node:path";
import { readJson } from "../files.js";
import { installationSchema } from "../configuration.js";
import { resolveConfigurationInputs, saveUnfinishedAi } from "../configure.js";
import { setupContext } from "../setup.js";
import { SetupInputs } from "../save.js";
import { collectModels, collectModelCredentials } from "./sections/models.js";

export type AiSetupResult = "ready" | "deferred" | "change";
const usd = (micros: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    micros / 1_000_000,
  );

export async function changeAiSetup(configFile: string, ui: InstallerPrompts) {
  try {
    const config = resolveConfigurationInputs(
      installationSchema.parse(await readJson(configFile)),
      dirname(configFile),
    );
    const context = await setupContext(
      config.models.mode === "litellm" && config.models.cloud
        ? { cloudUrl: config.models.cloud.url }
        : config.access.mode === "hosted"
          ? { cloudUrl: config.access.cloudUrl }
          : {},
      config.releaseFile,
    );
    const inputs = new SetupInputs(dirname(configFile));
    const models = await collectModelCredentials(
      ui,
      await collectModels(ui, context.modelCatalog, config.models, inputs),
      inputs,
    );
    await saveUnfinishedAi(configFile, models, inputs);
  } catch (error) {
    if (!(error instanceof SectionCancelled)) throw error;
  }
}

/** Presentation only: purchase persistence and Cloud calls belong to the billing operation. */
export async function completeAiFunding(
  session: CloudAiSession,
  ui: InstallerPrompts,
  task: typeof progress,
  options: AiFundingOptions & { nonInteractive?: boolean } = {},
): Promise<AiSetupResult> {
  if (options.aiCreditOffer && options.allowUnfundedAi)
    throw new InstallationError(
      "invalid_configuration",
      "Choose an AI credit pack or add credits later, not both.",
    );
  const result = await withCloudAiBilling(
    session,
    async (billing): Promise<AiSetupResult> => {
      let view = await task("Checking Cloud AI", (signal) =>
        billing.view(signal),
      );
      if (
        options.nonInteractive ||
        options.aiCreditOffer ||
        options.allowUnfundedAi
      ) {
        if (options.allowUnfundedAi)
          return view.state === "available" ? "ready" : "deferred";
        if (view.order?.status === "fulfilled") {
          if (view.state === "available") return "ready";
          throw new AiFundingRequired(view);
        }
        if (
          view.state === "available" &&
          !view.savedOfferId &&
          !options.aiCreditOffer
        )
          return "ready";
        const offer = view.savedOfferId ?? options.aiCreditOffer;
        const checkoutUrl = offer ? await billing.checkout(offer) : undefined;
        view = await billing.view();
        throw new AiFundingRequired({
          ...view,
          ...(checkoutUrl ? { checkoutUrl } : {}),
        });
      }
      for (;;) {
        if (view.state === "available" && !view.savedOfferId) return "ready";
        const pending = Boolean(view.savedOfferId);
        const awaitingPayment =
          !view.order || view.order.status === "checkout_ready";
        ui.note(
          pending
            ? "A purchase is saved. Check this payment before buying again. Closing the browser does not cancel or refund it."
            : view.state === "exhausted"
              ? "Buy prepaid credits to start using your selected model. Team login remains free."
              : "Cloud AI is not ready yet. Check its status, change AI setup, or finish setup and return to Account later.",
          pending
            ? "Check your AI purchase"
            : view.state === "exhausted"
              ? "Cloud AI requires prepaid credits"
              : "Cloud AI needs attention",
        );
        try {
          const choice = await ui.select("Cloud AI setup", [
            ...(pending && awaitingPayment
              ? [{ value: "buy", label: "Resume saved checkout" }]
              : []),
            ...(!pending && view.state === "exhausted" && view.offers.length
              ? [{ value: "buy", label: "Add credits" }]
              : []),
            { value: "check", label: "Check payment and credit status" },
            { value: "change", label: "Change AI setup" },
            {
              value: "later",
              label: "Finish setup and add credits later",
              hint: "Login works; AI may remain unavailable",
            },
          ]);
          if (choice === "change") return "change";
          if (choice === "later") return "deferred";
          if (choice === "buy") {
            const offerId =
              view.savedOfferId ??
              (await ui.select(
                "Choose an AI credit pack",
                view.offers.map((offer) => ({
                  value: offer.id,
                  label: `${usd(offer.amount)} AI credits — ${usd(offer.priceMinor * 10000)} USD + applicable tax`,
                  hint: "One-time purchase · No automatic recharge",
                })),
              ));
            const url = await task("Preparing secure checkout", (signal) =>
              billing.checkout(offerId, signal, !view.savedOfferId),
            );
            if (url) {
              ui.note(
                `Complete payment in your browser. Return here when finished.\n\n${terminalLink(url)}\n\nCtrl+C exits safely; run configure with this directory to resume the same purchase.`,
                "Secure checkout",
              );
              await ui.openBrowser(url);
            }
            view = await task(
              "Waiting for payment and credit activation",
              (signal) => billing.wait(signal),
            );
          } else {
            view = await task(
              "Checking payment and credit activation",
              (signal) => billing.wait(signal),
            );
          }
        } catch (error) {
          if (!(error instanceof SectionCancelled)) throw error;
          return "change";
        }
      }
    },
  );
  if (result !== "change")
    await rm(session.registrationFile + ".login", { force: true });
  return result;
}
