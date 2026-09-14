import { AccessError } from "../types/errors.js";
import * as oidc from "openid-client";
import type { LoginProvider } from "../types/model.js";
export interface OidcConfiguration {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export class DeploymentOidcProvider implements LoginProvider {
  private configuration: Promise<oidc.Configuration> | null = null;
  constructor(private readonly input: OidcConfiguration) {
    const u = new URL(input.issuer);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (u.protocol !== "https:" && !loopback(u))
    )
      throw Error("OIDC issuer must use HTTPS or local loopback HTTP.");
    if (!input.clientId || !input.clientSecret)
      throw Error("OIDC client configuration is required.");
  }
  private async discover() {
    if (!this.configuration)
      this.configuration = this.load().catch((error: unknown) => {
        this.configuration = null;
        throw error;
      });
    return this.configuration;
  }
  private async load() {
    const issuer = new URL(this.input.issuer),
      metadata = {
        client_secret: this.input.clientSecret,
        response_types: ["code"],
      };
    const c = await oidc.discovery(
      issuer,
      this.input.clientId,
      metadata,
      oidc.ClientSecretPost(this.input.clientSecret),
      {
        timeout: 10,
        ...(loopback(issuer) ? { execute: [oidc.allowInsecureRequests] } : {}),
      },
    );
    const methods = c.serverMetadata().token_endpoint_auth_methods_supported;
    if (!methods || methods.includes("client_secret_post")) return c;
    if (!methods.includes("client_secret_basic"))
      throw Error("Unsupported OIDC client authentication.");
    const basic = new oidc.Configuration(
      c.serverMetadata(),
      this.input.clientId,
      metadata,
      oidc.ClientSecretBasic(this.input.clientSecret),
    );
    basic.timeout = 10;
    if (loopback(issuer)) oidc.allowInsecureRequests(basic);
    return basic;
  }
  async authorization(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }) {
    try {
      return oidc
        .buildAuthorizationUrl(await this.discover(), {
          state: input.state,
          nonce: input.nonce,
          code_challenge: input.codeChallenge,
          code_challenge_method: "S256",
          redirect_uri: this.input.redirectUri,
          response_type: "code",
          scope: "openid profile email",
        })
        .toString();
    } catch {
      throw new AccessError(
        "dependency_unavailable",
        "Sign-in provider is temporarily unavailable.",
      );
    }
  }
  async exchange(input: {
    callbackUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<Awaited<ReturnType<LoginProvider["exchange"]>>> {
    const callback = new URL(input.callbackUrl),
      base = new URL(callback);
    base.search = "";
    base.hash = "";
    if (base.toString() !== new URL(this.input.redirectUri).toString())
      throw new AccessError("invalid_authorization", "Invalid login callback.");
    try {
      const result = await oidc.authorizationCodeGrant(
        await this.discover(),
        callback,
        {
          expectedNonce: input.nonce,
          expectedState: input.state,
          pkceCodeVerifier: input.codeVerifier,
          idTokenExpected: true,
        },
      );
      const claims = result.claims();
      if (!claims || !result.id_token) throw Error();
      const identity = {
        issuer: claim(claims.iss, 2048),
        subject: claim(claims.sub, 1024),
        email: claim(claims.email, 320).toLowerCase(),
        emailVerified: claims.email_verified === true,
        name:
          typeof claims.name === "string"
            ? claims.name.slice(0, 200)
            : claim(claims.email, 320),
      };
      const configuration = await this.discover();
      const logoutUrl = configuration.serverMetadata().end_session_endpoint
        ? oidc
            .buildEndSessionUrl(configuration, {
              id_token_hint: result.id_token,
              post_logout_redirect_uri: new URL(
                "/_clawscarf/signed-out",
                this.input.redirectUri,
              ).toString(),
            })
            .toString()
        : null;
      return { identity, logoutUrl };
    } catch {
      throw new AccessError(
        "invalid_authorization",
        "Login could not be verified. Start sign-in again.",
      );
    }
  }
}
function loopback(url: URL) {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
function claim(value: unknown, max: number) {
  if (typeof value !== "string" || !value || value.length > max)
    throw Error("Invalid identity claim.");
  return value;
}
