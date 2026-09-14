import { randomUUID } from "node:crypto";

import type { Principal } from "../types/authority.js";
import { CommonError } from "../shared/errors.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";
import { ConnectionError } from "../types/errors.js";
import type { ConnectionSetupService } from "./setup-service.js";

/** Browser transport retains an encrypted reference; setup verification owns every grant. */
export class ConnectionReturnService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly protection: ConnectionProtection,
    private readonly setups: Pick<ConnectionSetupService, "verify">,
  ) {}

  async stage(sessionRef: string, previousCookie: string | undefined) {
    if (!sessionRef || sessionRef.length > 8192)
      throw new CommonError(
        "invalid_request",
        "This connection return is invalid.",
      );
    const cookie = validCookie(previousCookie)
      ? previousCookie
      : this.protection.issueCredential().token;
    const id = randomUUID();
    const record = await this.repository.transaction((store) =>
      store.returns.stage({
        id,
        cookieHash: this.protection.hashCredential(cookie),
        sessionHash: this.protection.fingerprint(
          "connection-return",
          sessionRef,
        ),
        sealedSession: this.protection.seal(
          `connection-return:${id}`,
          sessionRef,
        ),
      }),
    );
    if (!record)
      throw new ConnectionError(
        "connection_return_capacity",
        "Connection setup is busy. Try again shortly.",
      );
    return { id: record.id, cookie, expiresAt: record.expiresAt };
  }

  async complete(actor: Principal, id: string, cookie: string | undefined) {
    if (!validCookie(cookie)) returnExpired();
    const record = await this.repository.transaction((store) =>
      store.returns.get(id, this.protection.hashCredential(cookie)),
    );
    if (!record) returnExpired();
    const sessionRef = this.protection.open(
      `connection-return:${record.id}`,
      record.sealedSession,
    );
    if (typeof sessionRef !== "string")
      throw Error("Invalid encrypted connection return.");
    return this.setups.verify(actor, sessionRef);
  }
}

function validCookie(cookie: string | undefined): cookie is string {
  return typeof cookie === "string" && /^[A-Za-z0-9_-]{43}$/.test(cookie);
}

function returnExpired(): never {
  throw new ConnectionError(
    "connection_return_expired",
    "This connection return expired. Go back to Connections to continue setup.",
  );
}
