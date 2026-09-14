import { denied } from "../shared/errors.js";
import type {
  ConnectorAdministratorProof,
  ConnectorAdministratorVerifier,
  ConnectorIdentity,
  ConnectorServerScope,
  Principal,
} from "../types/authority.js";

export class NativeConnectorAdministratorVerifier implements ConnectorAdministratorVerifier {
  constructor(
    private readonly identity: ConnectorIdentity,
    private readonly serverId: string,
  ) {}
  async verify(
    actor: Principal,
    scope: ConnectorServerScope,
  ): Promise<ConnectorAdministratorProof> {
    if (scope.serverId !== this.serverId) denied();
    const session = await this.identity.resolveSessionHash(actor.sessionHash);
    if (!session || session.user.id !== actor.user.id) denied();
    const native = await this.identity.verifyAdministrator(actor.sessionHash);
    if (native.userId !== actor.user.id) denied();
    return {
      serverId: this.serverId,
      userId: actor.user.id,
      sessionHash: actor.sessionHash,
      verifiedAt: new Date().toISOString(),
      agentIds: native.agentIds,
    };
  }
}
