import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
export async function oidcFixture(logout = false) {
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  let origin = "";
  let subject = "alice";
  let emailVerified = true;
  let invalidNonce = false;
  const clientSecret = randomBytes(32).toString("hex");
  const codes = new Map<
    string,
    {
      challenge: string;
      nonce: string;
      redirect: string;
      subject: string;
      emailVerified: boolean;
    }
  >();
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url!, origin);
        res.setHeader("Content-Type", "application/json");
        if (url.pathname === "/.well-known/openid-configuration") {
          res.end(
            JSON.stringify({
              issuer: origin,
              ...(logout ? { end_session_endpoint: origin + "/logout" } : {}),
              authorization_endpoint: origin + "/authorize",
              token_endpoint: origin + "/token",
              jwks_uri: origin + "/jwks",
              response_types_supported: ["code"],
              subject_types_supported: ["public"],
              id_token_signing_alg_values_supported: ["RS256"],
              token_endpoint_auth_methods_supported: ["client_secret_post"],
              code_challenge_methods_supported: ["S256"],
            }),
          );
          return;
        }
        if (url.pathname === "/jwks") {
          res.end(JSON.stringify({ keys: [jwk] }));
          return;
        }
        if (url.pathname === "/authorize") {
          const code = randomBytes(24).toString("hex"),
            q = url.searchParams;
          codes.set(code, {
            challenge: q.get("code_challenge")!,
            nonce: q.get("nonce")!,
            redirect: q.get("redirect_uri")!,
            subject,
            emailVerified,
          });
          const target = new URL(q.get("redirect_uri")!);
          target.searchParams.set("code", code);
          target.searchParams.set("state", q.get("state")!);
          res.writeHead(302, { Location: target.toString() });
          res.end();
          return;
        }
        if (url.pathname === "/logout" && logout) {
          if (!url.searchParams.get("id_token_hint"))
            throw Error("Expected logout hint");
          const destination = new URL(
            url.searchParams.get("post_logout_redirect_uri")!,
          );
          if (destination.hostname !== "127.0.0.1")
            throw Error("Expected local return");
          res.writeHead(302, { Location: destination.toString() });
          res.end();
          return;
        }
        if (url.pathname === "/token") {
          let text = "";
          for await (const chunk of req) text += String(chunk);
          const p = new URLSearchParams(text),
            code = p.get("code") ?? "",
            record = codes.get(code);
          codes.delete(code);
          if (
            !record ||
            p.get("client_id") !== "clawscarf-test" ||
            p.get("client_secret") !== clientSecret ||
            record.redirect !== p.get("redirect_uri") ||
            createHash("sha256")
              .update(p.get("code_verifier") ?? "")
              .digest("base64url") !== record.challenge
          ) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          const jwt = await new SignJWT({
            email: record.subject + "@example.test",
            email_verified: record.emailVerified,
            name: record.subject,
            nonce: invalidNonce ? "wrong" : record.nonce,
          })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setIssuer(origin)
            .setAudience("clawscarf-test")
            .setSubject(record.subject)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(keys.privateKey);
          res.end(
            JSON.stringify({
              access_token: randomBytes(24).toString("hex"),
              token_type: "Bearer",
              expires_in: 300,
              id_token: jwt,
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      } catch {
        res.statusCode = 500;
        res.end("{}");
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Invalid listener");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    clientId: "clawscarf-test",
    enableLogout: () => {
      logout = true;
    },
    clientSecret,
    setUser: (name: string, verified = true) => {
      subject = name;
      emailVerified = verified;
    },
    setInvalidNonce: (value: boolean) => {
      invalidNonce = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
