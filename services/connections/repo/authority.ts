import type { Transaction } from "./database.js";
import { denied } from "../shared/errors.js";
import type {
  ActorReference,
  ConnectorAdministratorProof,
  ConnectorIdentity,
  ConnectorManagementPermission,
  ConnectorServerAuthority,
  ConnectorServerScope,
  Principal,
} from "../types/authority.js";

/** Every management permission requires current native administrator authority. */
export class StandaloneConnectionAuthority implements ConnectorServerAuthority {
  constructor(
    private readonly client: Transaction,
    private readonly serverId: string,
    private readonly identity: ConnectorIdentity,
  ) {}
  async lock(scope: ConnectorServerScope) {
    if (scope.serverId !== this.serverId) denied();
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ["connections:" + this.serverId],
    );
  }
  async resolveActor(reference: ActorReference): Promise<Principal | null> {
    const session = await this.identity.resolveSessionHash(
      reference.sessionHash,
    );
    return session?.user.id === reference.userId
      ? { user: session.user, sessionHash: session.hash }
      : null;
  }
  async authorize(
    actor: Principal,
    scope: ConnectorServerScope,
    _permission: ConnectorManagementPermission,
    proof: ConnectorAdministratorProof,
  ) {
    await this.lock(scope);
    if (
      proof.serverId !== this.serverId ||
      proof.userId !== actor.user.id ||
      proof.sessionHash !== actor.sessionHash ||
      !Number.isFinite(Date.parse(proof.verifiedAt)) ||
      Date.parse(proof.verifiedAt) > Date.now() ||
      Date.now() - Date.parse(proof.verifiedAt) > 30_000 ||
      !(await this.resolveActor({
        userId: actor.user.id,
        sessionHash: actor.sessionHash,
      }))
    )
      denied();
  }
  async setupEligible(
    scope: ConnectorServerScope,
    userId: string,
    sessionHash: string,
  ) {
    if (scope.serverId !== this.serverId) return false;
    return (await this.resolveActor({ userId, sessionHash })) !== null;
  }

  async runtime(scope: ConnectorServerScope) {
    await this.lock(scope);
  }
}
