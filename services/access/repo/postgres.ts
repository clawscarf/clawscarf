import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { SessionLogoutProtection } from "./session-logout.js";
import { AccessError } from "../types/errors.js";
import type {
  AccessStore,
  Identity,
  LoginTransaction,
  Session,
  User,
} from "../types/model.js";
import { hash } from "../types/credential.js";
interface UserRow {
  id: string;
  email: string;
  name: string;
  revision: string;
  admitted: boolean;
}
const loginSchema = z
  .object({
    state: z.string(),
    nonce: z.string(),
    codeVerifier: z.string(),
    returnTo: z.string(),
    setupTokenHash: z.string().optional(),
    invitationTokenHash: z.string().optional(),
  })
  .strict();
const user = (row: UserRow): User => ({
  id: row.id,
  identity: `clawscarf:${row.id}`,
  email: row.email,
  name: row.name.trim() || row.email,
});
export interface InitialAdministrator {
  issuer: string;
  subject: string;
  email: string;
  name: string;
  claimRequired?: boolean;
}
/** Durable sessions and enrollment for one team server. */
export class PostgresAccessStore implements AccessStore {
  private readonly logoutProtection: SessionLogoutProtection;
  constructor(
    private readonly pool: Pool,
    private readonly key: Buffer,
    private readonly administrator: InitialAdministrator,
    private readonly client?: PoolClient,
  ) {
    if (key.length !== 32)
      throw Error("Access encryption key must contain 32 bytes.");
    this.logoutProtection = new SessionLogoutProtection(key);
  }
  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = this.client ?? (await this.pool.connect());
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!this.client) client.release();
    }
  }
  async withEnrollmentLock<T>(
    work: (store: AccessStore) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(174992004) AS locked",
      );
      locked = result.rows[0]?.locked === true;
      if (!locked)
        throw new AccessError(
          "rate_limited",
          "Another membership change is in progress. Try again.",
        );
      return await work(
        new PostgresAccessStore(
          this.pool,
          this.key,
          this.administrator,
          client,
        ),
      );
    } finally {
      try {
        if (locked) await client.query("SELECT pg_advisory_unlock(174992004)");
      } finally {
        client.release();
      }
    }
  }
  async invitations() {
    const result = await (this.client ?? this.pool).query<
      import("../types/model.js").Invitation
    >(
      `SELECT id,email,expires_at::text AS "expiresAt",
       CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN accepted_at IS NOT NULL THEN 'accepted'
       WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END AS status
       FROM clawscarf_access.invitations ORDER BY expires_at DESC LIMIT 1000`,
    );
    return result.rows.map((row) => ({
      ...row,
      expiresAt: new Date(row.expiresAt).toISOString(),
    }));
  }
  async createInvitation(sponsorId: string, email: string, tokenHash: string) {
    const result = await (this.client ?? this.pool).query<{
      id: string;
      email: string;
      expires_at: Date;
    }>(
      `INSERT INTO clawscarf_access.invitations(id,token_hash,email,sponsor_id,sponsor_revision)
       SELECT $1,$2,$3,id,revision FROM clawscarf_access.users WHERE id=$4 AND admitted
       AND (SELECT count(*) FROM clawscarf_access.invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now())<1000
       RETURNING id,email,expires_at`,
      [randomUUID(), tokenHash, email.toLowerCase(), sponsorId],
    );
    const row = result.rows[0];
    if (!row)
      throw new AccessError(
        "rate_limited",
        "Cannot create another invitation.",
      );
    return {
      id: row.id,
      email: row.email,
      expiresAt: row.expires_at.toISOString(),
      status: "pending" as const,
    };
  }
  async revokeInvitation(id: string) {
    await (this.client ?? this.pool).query(
      "UPDATE clawscarf_access.invitations SET revoked_at=clock_timestamp() WHERE id=$1 AND accepted_at IS NULL",
      [id],
    );
  }
  async bindInvitation(
    digest: string,
    identity: Identity,
    credentialHash: string,
  ) {
    if (!identity.emailVerified)
      throw new AccessError(
        "email_unverified",
        "Use a verified email address.",
      );
    return this.transaction(async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE clawscarf_access.invitations i SET subject=$2 FROM clawscarf_access.users u
         WHERE i.token_hash=$1 AND i.sponsor_id=u.id AND u.admitted AND u.revision=i.sponsor_revision
         AND u.issuer=$3 AND i.email=$4 AND (i.subject IS NULL OR i.subject=$2)
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp()
         RETURNING u.*`,
        [
          digest,
          identity.subject,
          identity.issuer,
          identity.email.toLowerCase(),
        ],
      );
      const sponsor = result.rows[0];
      if (!sponsor)
        throw new AccessError(
          "invalid_authorization",
          "Invitation expired, was used, or belongs to another account.",
        );
      await client.query(
        `INSERT INTO clawscarf_access.browser_sessions(hash,purpose,user_id,admission_revision,csrf,expires_at)
         VALUES($1,'invitation',$2,$3,'',clock_timestamp()+interval '3 minutes')`,
        [credentialHash, sponsor.id, sponsor.revision],
      );
      return { hash: credentialHash, user: user(sponsor), csrfToken: "" };
    });
  }
  async finishInvitation(
    digest: string,
    userId: string,
    sessionHash: string,
    csrf: string,
    logoutUrl: string | null,
  ) {
    await this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE clawscarf_access.invitations i SET accepted_at=clock_timestamp()
         FROM clawscarf_access.users sponsor,clawscarf_access.users target
         WHERE i.token_hash=$1 AND target.id=$2 AND target.subject=i.subject AND target.email=i.email
         AND sponsor.id=i.sponsor_id AND sponsor.admitted AND sponsor.revision=i.sponsor_revision
         AND target.issuer=sponsor.issuer AND NOT target.admitted
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp()`,
        [digest, userId],
      );
      if (result.rowCount !== 1)
        throw new AccessError(
          "invalid_authorization",
          "Invitation is no longer available.",
        );
      await client.query(
        "UPDATE clawscarf_access.users SET admitted=true,revision=revision+1 WHERE id=$1",
        [userId],
      );
      await this.insertSession(client, userId, sessionHash, csrf, logoutUrl);
    });
  }
  async eligibleIdentities() {
    const result = await (this.client ?? this.pool).query<{ id: string }>(
      "SELECT id FROM clawscarf_access.users WHERE admitted ORDER BY id",
    );
    return result.rows.map((row) => `clawscarf:${row.id}`);
  }
  async people() {
    const result = await (this.client ?? this.pool).query<UserRow>(
      "SELECT id, email, name, revision, admitted FROM clawscarf_access.users WHERE admitted ORDER BY name, id LIMIT 1000",
    );
    return result.rows.map(user);
  }
  async person(id: string) {
    const result = await (this.client ?? this.pool).query<UserRow>(
      "SELECT * FROM clawscarf_access.users WHERE id=$1",
      [id],
    );
    return result.rows[0] ? user(result.rows[0]) : null;
  }
  async initialize() {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(174992001)");
      const existing = await client.query<
        UserRow & { server_id: string; issuer: string; subject: string }
      >(
        "SELECT u.*,s.id AS server_id FROM clawscarf_access.server s JOIN clawscarf_access.users u ON u.id=s.administrator_id",
      );
      const row = existing.rows[0];
      if (row) {
        if (
          row.issuer !== this.administrator.issuer ||
          (!this.administrator.claimRequired &&
            row.subject !== this.administrator.subject)
        )
          throw Error(
            "Configured initial identity differs from this server database.",
          );
        return { serverId: row.server_id, administrator: user(row) };
      }
      const id = randomUUID(),
        serverId = randomUUID(),
        a = this.administrator;
      const inserted = await client.query<UserRow>(
        "INSERT INTO clawscarf_access.users(id,issuer,subject,email,name,admitted) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [id, a.issuer, a.subject, a.email, a.name, !a.claimRequired],
      );
      const created = inserted.rows[0];
      if (!created) throw Error("Administrator initialization failed.");
      await client.query(
        "INSERT INTO clawscarf_access.server(id,administrator_id,setup_complete) VALUES($1,$2,$3)",
        [serverId, id, !a.claimRequired],
      );
      return { serverId, administrator: user(created) };
    });
  }
  private seal(value: LoginTransaction) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString(
      "base64url",
    );
  }
  private open(value: string): LoginTransaction {
    const bytes = Buffer.from(value, "base64url"),
      cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return loginSchema.parse(
      JSON.parse(
        Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString(),
      ),
    );
  }
  async beginLogin(cookieHash: string, value: LoginTransaction) {
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(174992002)");
      await client.query(
        "DELETE FROM clawscarf_access.login_transactions WHERE expires_at<=now()",
      );
      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM clawscarf_access.login_transactions",
      );
      if ((count.rows[0]?.count ?? 1000) >= 1000)
        throw new AccessError(
          "rate_limited",
          "Too many pending logins. Try again later.",
        );
      await client.query(
        "INSERT INTO clawscarf_access.login_transactions(cookie_hash,state_hash,payload) VALUES($1,$2,$3)",
        [cookieHash, hash(value.state), this.seal(value)],
      );
    });
  }
  async consumeLogin(cookieHash: string, state: string) {
    const result = await (this.client ?? this.pool).query<{ payload: string }>(
      "DELETE FROM clawscarf_access.login_transactions WHERE cookie_hash=$1 AND state_hash=$2 AND expires_at>now() RETURNING payload",
      [cookieHash, hash(state)],
    );
    return result.rows[0] ? this.open(result.rows[0].payload) : null;
  }
  async admitIdentity(identity: Identity) {
    const result = await (this.client ?? this.pool).query<UserRow>(
      "UPDATE clawscarf_access.users SET email=$3,name=$4 WHERE issuer=$1 AND subject=$2 AND admitted RETURNING *",
      [
        identity.issuer,
        identity.subject,
        identity.email.toLowerCase(),
        identity.name,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new AccessError(
        "forbidden",
        "This account has not been admitted to this server.",
      );
    return user(row);
  }
  async createSession(
    userId: string,
    digest: string,
    csrfToken: string,
    logoutUrl: string | null,
  ) {
    await this.insertSession(
      this.client ?? this.pool,
      userId,
      digest,
      csrfToken,
      logoutUrl,
    );
  }
  private async insertSession(
    client: Pool | PoolClient,
    userId: string,
    digest: string,
    csrfToken: string,
    logoutUrl: string | null,
  ) {
    const result = await client.query(
      "INSERT INTO clawscarf_access.browser_sessions(hash,user_id,admission_revision,csrf,logout_redirect) SELECT $1,id,revision,$3,$4 FROM clawscarf_access.users WHERE id=$2 AND admitted",
      [
        digest,
        userId,
        csrfToken,
        logoutUrl === null
          ? null
          : this.logoutProtection.seal(digest, logoutUrl),
      ],
    );
    if (result.rowCount !== 1)
      throw new AccessError("forbidden", "This account is not admitted.");
  }
  async authenticateSession(digest: string): Promise<Session | null> {
    const result = await (this.client ?? this.pool).query<
      UserRow & { csrf: string }
    >(
      "SELECT u.*,s.csrf FROM clawscarf_access.browser_sessions s JOIN clawscarf_access.users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>clock_timestamp() AND (u.admitted OR s.purpose='enrollment' OR (s.purpose='setup' AND EXISTS(SELECT 1 FROM clawscarf_access.server initial WHERE initial.administrator_id=u.id AND NOT initial.setup_complete AND initial.setup_expires_at>clock_timestamp()))) AND s.admission_revision=u.revision AND (s.parent_hash IS NULL OR EXISTS(SELECT 1 FROM clawscarf_access.browser_sessions parent JOIN clawscarf_access.users parent_user ON parent_user.id=parent.user_id WHERE parent.hash=s.parent_hash AND parent.parent_hash IS NULL AND parent.expires_at>clock_timestamp() AND parent_user.admitted AND parent_user.revision=parent.admission_revision))",
      [digest],
    );
    return result.rows[0]
      ? {
          hash: digest,
          user: user(result.rows[0]),
          csrfToken: result.rows[0].csrf,
        }
      : null;
  }
  async createDelegation(parentHash: string, digest: string) {
    const result = await (this.client ?? this.pool).query(
      `INSERT INTO clawscarf_access.browser_sessions(hash,purpose,parent_hash,user_id,admission_revision,csrf,expires_at)
      SELECT $1,'management',s.hash,s.user_id,s.admission_revision,s.csrf,LEAST(s.expires_at,clock_timestamp()+interval '3 minutes')
      FROM clawscarf_access.browser_sessions s JOIN clawscarf_access.users u ON u.id=s.user_id
      WHERE s.hash=$2 AND s.parent_hash IS NULL AND s.expires_at>clock_timestamp() AND u.admitted AND s.admission_revision=u.revision`,
      [digest, parentHash],
    );
    if (result.rowCount !== 1)
      throw new AccessError("unauthenticated", "Sign in to continue.");
  }
  async createEnrollmentDelegation(
    parentHash: string,
    userId: string,
    digest: string,
  ) {
    const result = await (this.client ?? this.pool).query(
      `INSERT INTO clawscarf_access.browser_sessions(hash,purpose,parent_hash,user_id,admission_revision,csrf,expires_at)
      SELECT $1,'enrollment',s.hash,target.id,target.revision,s.csrf,LEAST(s.expires_at,clock_timestamp()+interval '3 minutes')
      FROM clawscarf_access.browser_sessions s JOIN clawscarf_access.users actor ON actor.id=s.user_id
      CROSS JOIN clawscarf_access.users target
      WHERE s.hash=$2 AND s.parent_hash IS NULL AND s.expires_at>clock_timestamp() AND actor.admitted AND actor.revision=s.admission_revision AND target.id=$3 AND NOT target.admitted`,
      [digest, parentHash, userId],
    );
    if (result.rowCount !== 1)
      throw new AccessError("forbidden", "Enrollment is unavailable.");
  }
  async prepareEnrollment(identity: Identity) {
    const result = await (this.client ?? this.pool).query<UserRow>(
      `INSERT INTO clawscarf_access.users(id,issuer,subject,email,name)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email,name=excluded.name
      WHERE NOT clawscarf_access.users.admitted RETURNING *`,
      [
        randomUUID(),
        identity.issuer,
        identity.subject,
        identity.email,
        identity.name,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new AccessError(
        "invalid_request",
        "This person is already admitted.",
      );
    return user(row);
  }
  async activateEnrollment(id: string) {
    await (this.client ?? this.pool).query(
      "UPDATE clawscarf_access.users SET admitted=true,revision=revision+1 WHERE id=$1 AND NOT admitted",
      [id],
    );
  }
  async removeEnrollment(id: string) {
    await (this.client ?? this.pool).query(
      "UPDATE clawscarf_access.users SET admitted=false,revision=revision+1 WHERE id=$1",
      [id],
    );
  }
  async revokeDelegation(digest: string) {
    await (this.client ?? this.pool).query(
      "DELETE FROM clawscarf_access.browser_sessions WHERE hash=$1 AND (parent_hash IS NOT NULL OR purpose IN ('setup','invitation'))",
      [digest],
    );
  }
  async revokeSession(digest: string) {
    const result = await (this.client ?? this.pool).query<{
      logout_redirect: string | null;
    }>(
      "DELETE FROM clawscarf_access.browser_sessions WHERE hash=$1 RETURNING logout_redirect",
      [digest],
    );
    const row = result.rows[0];
    if (!row) throw new AccessError("unauthenticated", "Sign in to continue.");
    return row.logout_redirect === null
      ? null
      : this.logoutProtection.open(digest, row.logout_redirect);
  }
  async createLocalToken(digest: string) {
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(174992003)");
      await client.query("DELETE FROM clawscarf_access.local_tokens");
      await client.query(
        "INSERT INTO clawscarf_access.local_tokens(hash) VALUES($1)",
        [digest],
      );
    });
  }
  async administratorSetup() {
    const result = await (this.client ?? this.pool).query<{
      setup_complete: boolean;
      setup_expires_at: Date | null;
    }>("SELECT setup_complete,setup_expires_at FROM clawscarf_access.server");
    const row = result.rows[0];
    if (!row)
      throw new AccessError(
        "dependency_unavailable",
        "Server identity is unavailable.",
      );
    return {
      complete: row.setup_complete,
      expiresAt: row.setup_expires_at?.toISOString() ?? null,
    };
  }
  async beginAdministratorSetup(digest: string) {
    await this.transaction(async (client) => {
      const result = await client.query(
        "UPDATE clawscarf_access.server SET setup_token_hash=$1,setup_expires_at=clock_timestamp()+interval '15 minutes' WHERE NOT setup_complete",
        [digest],
      );
      if (result.rowCount !== 1)
        throw new AccessError(
          "forbidden",
          "Administrator setup is already complete.",
        );
      await client.query(
        "DELETE FROM clawscarf_access.browser_sessions WHERE purpose='setup'",
      );
    });
  }
  async bindAdministrator(
    digest: string,
    identity: Identity,
    sessionHash: string,
  ) {
    if (!identity.emailVerified)
      throw new AccessError(
        "email_unverified",
        "Use a verified email address.",
      );
    return this.transaction(async (client) => {
      const claim = await client.query<{ administrator_id: string }>(
        `UPDATE clawscarf_access.server SET setup_subject=$2
         WHERE NOT setup_complete AND setup_token_hash=$1 AND setup_expires_at>clock_timestamp()
         AND (setup_subject IS NULL OR setup_subject=$2) RETURNING administrator_id`,
        [digest, identity.subject],
      );
      const id = claim.rows[0]?.administrator_id;
      if (!id)
        throw new AccessError(
          "invalid_authorization",
          "Setup expired, was already used, or belongs to another account.",
        );
      const result = await client.query<UserRow>(
        "UPDATE clawscarf_access.users SET subject=$2,email=$3,name=$4 WHERE id=$1 AND issuer=$5 AND NOT admitted RETURNING *",
        [
          id,
          identity.subject,
          identity.email.toLowerCase(),
          identity.name,
          identity.issuer,
        ],
      );
      const person = result.rows[0];
      if (!person)
        throw new AccessError(
          "forbidden",
          "This identity cannot claim the server.",
        );
      await client.query(
        "INSERT INTO clawscarf_access.browser_sessions(hash,purpose,user_id,admission_revision,csrf,expires_at) SELECT $1,'setup',id,revision,'',clock_timestamp()+interval '3 minutes' FROM clawscarf_access.users WHERE id=$2",
        [sessionHash, id],
      );
      return user(person);
    });
  }
  async finishAdministratorSetup(
    digest: string,
    userId: string,
    sessionHash: string,
    csrfToken: string,
    logoutUrl: string | null,
  ) {
    await this.transaction(async (client) => {
      const claimed = await client.query(
        "UPDATE clawscarf_access.server SET setup_complete=true,setup_token_hash=NULL,setup_expires_at=NULL WHERE NOT setup_complete AND setup_token_hash=$1 AND administrator_id=$2 AND setup_subject IS NOT NULL AND setup_expires_at>clock_timestamp() RETURNING id",
        [digest, userId],
      );
      if (claimed.rowCount !== 1)
        throw new AccessError(
          "invalid_authorization",
          "Setup expired or was already used.",
        );
      await client.query(
        "UPDATE clawscarf_access.users SET admitted=true,revision=revision+1 WHERE id=$1",
        [userId],
      );
      await client.query(
        "DELETE FROM clawscarf_access.browser_sessions WHERE purpose='setup' AND user_id=$1",
        [userId],
      );
      await this.insertSession(
        client,
        userId,
        sessionHash,
        csrfToken,
        logoutUrl,
      );
    });
  }
  async createLocalSession(
    digest: string,
    sessionHash: string,
    csrfToken: string,
  ) {
    return this.transaction(async (client) => {
      const consumed = await client.query(
        "UPDATE clawscarf_access.local_tokens SET consumed_at=clock_timestamp() WHERE hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING hash",
        [digest],
      );
      if (consumed.rowCount !== 1) return false;
      const result = await client.query<UserRow>(
        "SELECT u.* FROM clawscarf_access.users u JOIN clawscarf_access.server s ON s.administrator_id=u.id WHERE u.admitted",
      );
      const person = result.rows[0];
      if (!person)
        throw new AccessError("forbidden", "This account is not admitted.");
      await this.insertSession(client, person.id, sessionHash, csrfToken, null);
      return true;
    });
  }
  async localTokenStatus(digest: string) {
    const result = await (this.client ?? this.pool).query<{
      consumed_at: Date | null;
      expires_at: Date;
    }>(
      "SELECT consumed_at,expires_at FROM clawscarf_access.local_tokens WHERE hash=$1",
      [digest],
    );
    const row = result.rows[0];
    return {
      complete: row?.consumed_at != null,
      expiresAt: row?.expires_at.toISOString() ?? null,
    };
  }
}
