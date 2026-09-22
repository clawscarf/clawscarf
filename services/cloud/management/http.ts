import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import openapiGlue from "fastify-openapi-glue";
import { z } from "zod";
import { createClient } from "../../../generated/http/client/index.js";
import * as cloud from "../generated/sdk.gen.js";
import { AccessError } from "../../access/types/errors.js";
import type {
  AccessRuntimeApi,
  NativeAuthority,
} from "../../access/types/native.js";
import { administratorProof } from "../../access/runtime/administrator.js";
import type { CloudService } from "./config.js";
import { ownerAuthorization, type OwnerAuthorization } from "./owner.js";
import type { RouteHandlers } from "./generated/fastify.gen.js";

export async function registerCloudManagement(
  app: FastifyInstance,
  input: {
    services: CloudService[];
    access: AccessRuntimeApi;
    native: NativeAuthority;
    origin: string;
    owner?: OwnerAuthorization;
  },
) {
  const proof = administratorProof(input);
  const owner = input.owner ?? ownerAuthorization();
  app.addHook("onClose", () => {
    owner.close();
  });
  const targets = new Map(
    await Promise.all(
      input.services.map(async (target) => {
        const credential = (
          await readFile(target.managementKeyFile, "utf8")
        ).trim();
        if (!/^[A-Za-z0-9_-]{43,128}$/.test(credential))
          throw Error("Invalid Cloud management credential.");
        return [
          target.id,
          {
            target,
            credential,
            client: createClient({ baseUrl: target.url, redirect: "error" }),
          },
        ] as const;
      }),
    ),
  );
  async function access(request: FastifyRequest, id: string) {
    const assertion = await proof(request);
    const scoped = targets.get(id);
    if (!scoped)
      throw new AccessError(
        "invalid_request",
        "This Cloud service is not configured for this installation.",
      );
    return {
      ...scoped,
      key: assertion.sessionHash + ":" + id,
      request: {
        client: scoped.client,
        signal: AbortSignal.timeout(60_000),
        headers: {
          authorization: `Bearer ${scoped.credential}`,
          "x-clawscarf-administrator": Buffer.from(
            JSON.stringify(assertion),
          ).toString("base64url"),
        },
      },
    };
  }
  function send(
    reply: FastifyReply,
    result: { response?: Response; data?: unknown; error?: unknown },
    ownerKey?: string,
  ) {
    if (!result.response)
      throw new AccessError(
        "dependency_unavailable",
        "ClawScarf Cloud is unavailable. Your last displayed balance may be out of date.",
      );
    if (result.error) {
      if (result.response.status === 401 && ownerKey) owner.forget(ownerKey);
      const failure = z
        .object({ code: z.string(), requestId: z.string().optional() })
        .safeParse(result.error);
      const code = failure.success ? failure.data.code : "service_unavailable";
      const messages: Record<string, string> = {
        permission_denied:
          "Sign in as the Cloud account owner to manage payments.",
        authentication_required:
          "Cloud billing sign-in expired. Sign in again.",
        request_conflict:
          "This purchase request changed. Check your order before starting another purchase.",
        service_unavailable:
          "Cloud billing is unavailable. Check order status before trying again.",
        credit_exhausted:
          "AI credits have run out. Add credits in Account to continue.",
        revision_conflict: "Cloud settings changed. Refresh and try again.",
      };
      return reply
        .code(result.response.status)
        .type("application/problem+json")
        .send({
          type: "about:blank",
          title: code,
          code,
          status: result.response.status,
          detail:
            messages[code] ??
            "Cloud could not complete this request. Refresh and check its status.",
          requestId:
            failure.success && failure.data.requestId
              ? failure.data.requestId
              : reply.request.id,
        });
    }
    return reply.code(result.response.status).send(result.data);
  }
  async function purchaseContext(
    request: FastifyRequest,
    id: string,
    requestId: string,
    path: string,
  ) {
    const a = await access(request, id);
    const auth = owner.token(a.key);
    const returned = await cloud.createBillingReturn({
      ...a.request,
      path: { id },
      body: { requestId, path },
    });
    if (!returned.data)
      throw new AccessError(
        "dependency_unavailable",
        "The payment return could not be prepared. Retry the same purchase request.",
      );
    return {
      key: a.key,
      request: {
        ...a.request,
        headers: { ...a.request.headers, authorization: `Bearer ${auth}` },
      },
      returnId: returned.data.returnId,
    };
  }
  const handlers = {
    getCloudCapabilities: async (r, p) => {
      await input.access.authenticate(r.cookies.clawscarf_session ?? "");
      return p.code(200).send({
        ai: input.services.some((service) => service.ai),
        connections: input.services.some((service) => service.connections),
      });
    },
    listCloudServices: async (r, p) => {
      await proof(r);
      return p.code(200).send({
        services: input.services.map(({ id, url, ai, connections }) => ({
          id,
          url,
          ai,
          connections,
        })),
      });
    },
    getCloudAllowances: async (r, p) => {
      const a = await access(r, r.params.id);
      return send(
        p,
        await cloud.getInstallationAllowances({
          ...a.request,
          path: { id: r.params.id },
        }),
      );
    },
    getCloudOffers: async (r, p) => {
      const a = await access(r, r.params.id);
      return send(p, await cloud.getBillingOffers(a.request));
    },
    getCloudModels: async (r, p) => {
      const a = await access(r, r.params.id);
      return send(p, await cloud.getAiModels(a.request));
    },
    getCloudAuthorization: async (r, p) => {
      const a = await access(r, r.params.id);
      return p.code(200).send(owner.state(a.key));
    },
    startCloudAuthorization: async (r, p) => {
      const a = await access(r, r.params.id);
      return p.code(200).send(await owner.start(a.key, a.target));
    },
    pollCloudAuthorization: async (r, p) => {
      const a = await access(r, r.params.id);
      return p.code(200).send(await owner.poll(a.key, a.target));
    },
    forgetCloudAuthorization: async (r, p) => {
      const a = await access(r, r.params.id);
      owner.forget(a.key);
      return p.code(200).send({ ok: true });
    },
    createCloudCheckout: async (r, p) => {
      const a = await purchaseContext(
        r,
        r.params.id,
        r.body.requestId,
        r.body.returnPath,
      );
      return send(
        p,
        await cloud.createBillingCheckout({
          ...a.request,
          body: {
            requestId: r.body.requestId,
            offerId: r.body.offerId,
            quantity: r.body.quantity,
            installationId: r.params.id,
            returnId: a.returnId,
          },
        }),
        a.key,
      );
    },
    listCloudOrders: async (r, p) => {
      const a = await access(r, r.params.id);
      return send(
        p,
        await cloud.listBillingOrders({
          ...a.request,
          headers: {
            ...a.request.headers,
            authorization: `Bearer ${owner.token(a.key)}`,
          },
          query: { limit: 20 },
        }),
        a.key,
      );
    },
    getCloudOrder: async (r, p) => {
      const a = await access(r, r.params.id);
      return send(
        p,
        await cloud.getBillingOrder({
          ...a.request,
          headers: {
            ...a.request.headers,
            authorization: `Bearer ${owner.token(a.key)}`,
          },
          path: { orderId: r.params.orderId },
        }),
        a.key,
      );
    },
    createCloudPortal: async (r, p) => {
      const a = await purchaseContext(
        r,
        r.params.id,
        r.body.requestId,
        r.body.returnPath,
      );
      return send(
        p,
        await cloud.createBillingPortal({
          ...a.request,
          body: { returnId: a.returnId },
        }),
        a.key,
      );
    },
  } satisfies RouteHandlers;
  await app.register(openapiGlue, {
    specification: fileURLToPath(new URL("./openapi.json", import.meta.url)),
    serviceHandlers: handlers,
  });
}
