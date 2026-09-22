import * as oidc from "openid-client";
import { z } from "zod";
import { createClient } from "../../../generated/http/client/index.js";
import { getAccount, getCliIdentity } from "../generated/sdk.gen.js";
import { AccessError } from "../../access/types/errors.js";
import type { CloudService } from "./config.js";
import type { CloudAuthorization } from "./generated/types.gen.js";

type Pending = {
  configuration: oidc.Configuration;
  code: string;
  deviceCode: string;
  url: string;
  expires: number;
  interval: number;
  nextPoll: number;
  token?: string;
};
export interface OwnerAuthorization {
  state(key: string): CloudAuthorization;
  start(key: string, target: CloudService): Promise<CloudAuthorization>;
  poll(key: string, target: CloudService): Promise<CloudAuthorization>;
  token(key: string): string;
  forget(key: string): void;
  close(): void;
}

/** Short-lived owner authority is bound to one admitted browser session and Cloud installation. */
export function ownerAuthorization(): OwnerAuthorization {
  const pending = new Map<string, Pending>();
  const disconnected: CloudAuthorization = {
    state: "disconnected",
    url: null,
    code: null,
    expiresAt: null,
    pollAfterSeconds: 0,
  };
  function current(key: string) {
    const p = pending.get(key);
    if (p && p.expires <= Date.now()) {
      pending.delete(key);
      return undefined;
    }
    return p;
  }
  function state(key: string): CloudAuthorization {
    const p = current(key);
    return p
      ? {
          state: p.token ? "authorized" : "pending",
          url: p.token ? null : p.url,
          code: p.token ? null : p.code,
          expiresAt: new Date(p.expires).toISOString(),
          pollAfterSeconds: p.token
            ? 0
            : Math.max(1, Math.ceil((p.nextPoll - Date.now()) / 1000)),
        }
      : disconnected;
  }
  return {
    state,
    async start(key, target) {
      if (current(key)) return state(key);
      for (const key of pending.keys()) current(key);
      if (pending.size >= 64)
        throw new AccessError(
          "rate_limited",
          "Too many pending billing sign-ins. Try again after they expire.",
        );
      const client = createClient({ baseUrl: target.url, redirect: "error" });
      const identity = await getCliIdentity({
        client,
        signal: AbortSignal.timeout(10_000),
      });
      if (!identity.data)
        throw new AccessError(
          "dependency_unavailable",
          "Cloud owner sign-in is unavailable.",
        );
      const config = z
        .object({
          issuer: z
            .url()
            .refine((value) => new URL(value).protocol === "https:"),
          clientId: z.string().min(1),
        })
        .parse(identity.data);
      const configuration = await oidc.discovery(
        new URL(config.issuer),
        config.clientId,
        undefined,
        oidc.None(),
        { timeout: 10 },
      );
      const challenge = await oidc.initiateDeviceAuthorization(configuration, {
        scope: "openid profile email",
      });
      const url = new URL("/setup", target.url);
      url.searchParams.set("code", challenge.user_code);
      const p = {
        configuration,
        code: challenge.user_code,
        deviceCode: challenge.device_code,
        url: url.href,
        expires: Date.now() + challenge.expires_in * 1000,
        interval: (challenge.interval ?? 5) * 1000,
        nextPoll: Date.now() + (challenge.interval ?? 5) * 1000,
      };
      pending.set(key, p);
      return state(key);
    },
    async poll(key, target) {
      const p = current(key);
      if (!p || p.token) return state(key);
      if (p.nextPoll > Date.now()) return state(key);
      p.nextPoll = Date.now() + p.interval;
      try {
        const result = await oidc.genericGrantRequest(
          p.configuration,
          "urn:ietf:params:oauth:grant-type:device_code",
          { device_code: p.deviceCode },
        );
        const account = await getAccount({
          client: createClient({ baseUrl: target.url, redirect: "error" }),
          headers: { authorization: `Bearer ${result.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!account.data || account.data.accountId !== target.accountId) {
          pending.delete(key);
          throw new AccessError(
            "forbidden",
            "Sign in with the Cloud account that owns this installation. Installation administrator rights do not grant billing ownership.",
          );
        }
        p.token = result.access_token;
        p.expires = Date.now() + Math.min(result.expires_in ?? 60, 1800) * 1000;
        return state(key);
      } catch (error) {
        if (error instanceof AccessError) throw error;
        if (error instanceof oidc.ResponseBodyError) {
          if (error.error === "authorization_pending") return state(key);
          if (error.error === "slow_down") {
            p.interval += 5000;
            p.nextPoll = Date.now() + p.interval;
            return state(key);
          }
          if (
            ["access_denied", "expired_token", "invalid_grant"].includes(
              error.error,
            )
          ) {
            pending.delete(key);
            throw new AccessError(
              "forbidden",
              "Billing sign-in was declined or expired. Start a new sign-in to continue.",
            );
          }
        }
        throw new AccessError(
          "dependency_unavailable",
          "Billing sign-in could not be confirmed. Check its status before starting again.",
        );
      }
    },
    token(key) {
      const p = current(key);
      if (!p?.token)
        throw new AccessError(
          "forbidden",
          "Sign in as the Cloud account owner to manage payments.",
        );
      return p.token;
    },
    forget(key) {
      pending.delete(key);
    },
    close() {
      pending.clear();
    },
  };
}
