import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { CloudAiBilling, AiFundingRequired } from "./cloud/billing.js";
import { completeAiFunding } from "./installation/installer/billing.js";
import {
  unattendedPrompts,
  type progress,
  type InstallerPrompts,
} from "./installation/installer/prompts.js";

const task: typeof progress = async (_message, work) =>
  work(new AbortController().signal, () => {});
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "cs-billing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = Fastify();
  t.after(() => server.close());
  const session = {
    url: "",
    installationId: randomUUID(),
    accountId: randomUUID(),
    authorization: "owner-secret",
    registrationFile: join(directory, "registration.json"),
  };
  const state = { available: 0, state: "exhausted" };
  let unauthorized = false,
    lost = false,
    checkoutUrl = "https://checkout.stripe.com/c/pay/test";
  let dispatches = 0;
  const requests = new Map<string, string>();
  const orders = new Map<
    string,
    {
      id: string;
      installationId: string;
      service: string;
      offerId: string;
      status: string;
      refundedMinor: number;
      disputedMinor: number;
    }
  >();
  const returns = new Map<string, string>();
  server.addHook("onRequest", (request, reply, done) => {
    assert.equal(request.headers.authorization, "Bearer owner-secret");
    assert.equal(request.headers.cookie, undefined);
    if (unauthorized)
      return reply.code(401).send({ error: "authentication_required" });
    done();
  });
  server.get("/api/installations/:id/allowances", () => ({ ai: state }));
  server.get("/api/billing/offers", () => ({
    purchasingAvailable: true,
    offers: [
      {
        id: "ai-10",
        title: "AI credits",
        service: "ai",
        currency: "usd",
        priceMinor: 1000,
        amount: 10000000,
        maxQuantity: 10,
        purchaseType: "one_time",
        taxBehavior: "exclusive",
        unit: "usd_micros",
      },
    ],
  }));
  server.post("/api/installations/:id/billing-returns", (request) => {
    const body = z
      .object({ requestId: z.uuid(), path: z.null() })
      .parse(request.body);
    assert.equal(
      z.object({ requestId: z.uuid() }).parse(JSON.parse(requireSaved()))
        .requestId,
      body.requestId,
    );
    const id = returns.get(body.requestId) ?? randomUUID();
    returns.set(body.requestId, id);
    return { returnId: id };
  });
  let saved = "";
  const requireSaved = () => saved;
  // Read the durable file at dispatch, not after success, to cover uncertain outcomes.
  server.addHook("preHandler", async (request) => {
    if (request.method === "POST")
      saved = await readFile(
        session.registrationFile + ".billing.json",
        "utf8",
      );
  });
  server.post("/api/billing/checkouts", (request, reply) => {
    dispatches++;
    const body = z
      .object({
        requestId: z.uuid(),
        installationId: z.uuid(),
        returnId: z.uuid(),
        offerId: z.string(),
        quantity: z.literal(1),
      })
      .parse(request.body);
    assert.equal(returns.get(body.requestId), body.returnId);
    assert.equal(body.installationId, session.installationId);
    const id = requests.get(body.requestId) ?? randomUUID();
    requests.set(body.requestId, id);
    if (!orders.has(id))
      orders.set(id, {
        id,
        installationId: body.installationId,
        service: "ai",
        offerId: body.offerId,
        status: "checkout_ready",
        refundedMinor: 0,
        disputedMinor: 0,
      });
    if (lost) {
      lost = false;
      reply.raw.destroy();
      return reply;
    }
    return { orderId: id, checkoutUrl };
  });
  server.get("/api/billing/orders/:orderId", (request, reply) => {
    const { orderId } = z.object({ orderId: z.uuid() }).parse(request.params);
    const order = orders.get(orderId);
    return order ?? reply.code(404).send({ error: "not_found" });
  });
  session.url = await server.listen({ host: "127.0.0.1", port: 0 });
  await writeFile(session.registrationFile + ".login", "owner-secret", {
    mode: 0o600,
  });
  return {
    session,
    state,
    orders,
    requests,
    get dispatches() {
      return dispatches;
    },
    lose: () => {
      lost = true;
    },
    expireLogin: () => {
      unauthorized = true;
    },
    destination: (url: string) => {
      checkoutUrl = url;
    },
  };
}

await test("checkout survives a lost response and process restart without a second order", async (t) => {
  const f = await fixture(t);
  const first = new CloudAiBilling(f.session);
  await first.load();
  assert.equal((await first.view()).state, "exhausted");
  f.lose();
  await assert.rejects(first.checkout("ai-10"), /Checkout was not confirmed/);
  const path = f.session.registrationFile + ".billing.json";
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(path, "utf8"), /owner-secret/);
  const resumed = new CloudAiBilling(f.session);
  await resumed.load();
  assert.equal((await resumed.view()).savedOfferId, "ai-10");
  assert.equal(
    await resumed.checkout("ai-10"),
    "https://checkout.stripe.com/c/pay/test",
  );
  assert.equal(f.orders.size, 1);
  assert.equal(f.requests.size, 1);
  const order = [...f.orders.values()][0];
  assert.ok(order);
  order.status = "paid";
  assert.equal(
    (await resumed.view()).savedOfferId,
    "ai-10",
    "payment is not yet fulfillment",
  );
  order.status = "fulfilled";
  f.state.state = "available";
  f.state.available = 10000000;
  assert.equal(
    await completeAiFunding(f.session, unattendedPrompts, task, {
      nonInteractive: true,
      aiCreditOffer: "ai-10",
    }),
    "ready",
  );
  assert.equal(
    f.dispatches,
    2,
    "resuming the offer flag after payment must not start another checkout",
  );
});

await test("unfunded setup needs an explicit decision; funded setup is silent", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    completeAiFunding(f.session, unattendedPrompts, task, {
      nonInteractive: true,
    }),
    AiFundingRequired,
  );
  assert.equal(
    await completeAiFunding(f.session, unattendedPrompts, task, {
      nonInteractive: true,
      allowUnfundedAi: true,
    }),
    "deferred",
  );
  assert.equal(f.dispatches, 0);
  const notes: string[] = [];
  const ui: InstallerPrompts = {
    ...unattendedPrompts,
    note: (message) => {
      notes.push(message);
    },
    select: (_message, choices) => {
      assert.ok(choices.some((c) => c.value === "change"));
      return Promise.resolve("later");
    },
  };
  assert.equal(await completeAiFunding(f.session, ui, task), "deferred");
  assert.match(notes.join(), /prepaid/);
  notes.length = 0;
  f.state.state = "available";
  f.state.available = 960000;
  assert.equal(await completeAiFunding(f.session, ui, task), "ready");
  assert.deepEqual(notes, []);
});

await test("wrong-owner resume, expired login and untrusted checkout destinations fail safely", async (t) => {
  const f = await fixture(t);
  const billing = new CloudAiBilling(f.session);
  await billing.load();
  f.destination("https://attacker.example/checkout");
  await assert.rejects(
    billing.checkout("ai-10"),
    /unexpected checkout destination/,
  );
  const wrong = new CloudAiBilling({ ...f.session, accountId: randomUUID() });
  await assert.rejects(wrong.load(), /another Cloud installation/);
  f.expireLogin();
  await assert.rejects(billing.view(), /status is unavailable/);
  await assert.rejects(stat(f.session.registrationFile + ".login"), {
    code: "ENOENT",
  });
  assert.ok(await stat(f.session.registrationFile + ".billing.json"));
});
