import { randomUUID } from "node:crypto";
import type {
  ConnectorAdministratorVerifier,
  ConnectorServerScope,
  Principal,
} from "../types/authority.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";

/** Explicit credential rotation. Issuance does not claim that a plugin is installed. */
export class ConnectionCredentialManagement {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly protection: ConnectionProtection,
  ) {}
  async rotate(actor: Principal, scope: ConnectorServerScope) {
    const proof = await this.verifier.verify(actor, scope);
    return this.repository.transaction(async (store) => {
      await store.authority.authorize(
        actor,
        scope,
        "installation-connections:write",
        proof,
      );
      const previous = await store.credentials.latest(scope);
      const issued = this.protection.issueCredential();
      const credentialId = randomUUID();
      const generation = (previous?.credentialGeneration ?? 0) + 1;
      await store.credentials.revoke(scope);
      await store.credentials.save({
        ...scope,
        credentialId,
        credentialGeneration: generation,
        hash: issued.hash,
        state: "active",
      });
      return { credentialId, generation, token: issued.token };
    });
  }
  async revoke(actor: Principal, scope: ConnectorServerScope) {
    const proof = await this.verifier.verify(actor, scope);
    await this.repository.transaction(async (store) => {
      await store.authority.authorize(
        actor,
        scope,
        "installation-connections:write",
        proof,
      );
      await store.credentials.revoke(scope);
    });
  }
}
