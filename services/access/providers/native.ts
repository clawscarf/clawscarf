import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { NativeActor, NativeAuthority } from "../types/native.js";
import type { User } from "../types/model.js";
import { NativeFailure } from "../types/native-errors.js";
import { withGateway, type NativeGateway } from "./gateway.js";
import { observeEnrollmentConnection } from "./enrollment-observation.js";
import {
  identityScopes,
  parseNative,
  patch,
  pendingPolicy,
  pendingRole,
  profileFor,
  readState,
  requireTeam,
  teamEnrollmentState,
  self,
  type NativeState,
} from "./native-state.js";

/** Native enrollment without a parallel role database. */
export class OpenClawAuthority implements NativeAuthority {
  constructor(
    private readonly origin: string,
    private readonly options: {
      endpoint?: string;
      connect?: typeof withGateway;
    } = {},
  ) {}
  private get connect() {
    return this.options.connect ?? withGateway;
  }
  private gatewayOptions(credential: string, scopes?: string[]) {
    return {
      origin: this.origin,
      credential,
      ...(this.options.endpoint ? { endpoint: this.options.endpoint } : {}),
      ...(scopes ? { scopes } : {}),
    };
  }

  private acting<T>(
    actor: NativeActor,
    credential: string,
    work: (gateway: NativeGateway) => Promise<T>,
  ) {
    return this.connect(this.gatewayOptions(credential), async (gateway) => {
      if (!gateway.scopes.includes("operator.admin"))
        throw new NativeFailure("access_denied");
      await self(gateway, actor.identity);
      return work(gateway);
    });
  }

  async verifyAdministrator(actor: NativeActor, credential: string) {
    return this.acting(actor, credential, async (gateway) => {
      const result = parseNative(
        z.object({ agents: z.array(z.object({ id: z.string().min(1) })) }),
        await gateway.read("agents.list", {}),
      );
      return { agentIds: result.agents.map((agent) => agent.id) };
    });
  }

  async observeTeam(actor: NativeActor, credential: string) {
    return this.acting(actor, credential, async (gateway) => {
      return teamEnrollmentState(await readState(gateway));
    });
  }

  async prepareTeam(actor: NativeActor, credential: string) {
    if (actor.name)
      await this.enrichName(actor, credential, {
        identity: actor.identity,
        name: actor.name,
      });
    const observe = () => this.acting(actor, credential, readState);
    const before = await observe();
    const roles = before.config.gateway.roles;
    if (roles.default === pendingRole) {
      requireTeam(before);
      return;
    }
    if (
      roles.definitions[pendingRole] &&
      !isDeepStrictEqual(roles.definitions[pendingRole], pendingPolicy)
    )
      throw new NativeFailure("revision_conflict");
    if (!roles.definitions[roles.default])
      throw new NativeFailure("invalid_response");
    // Preserve every existing default-role profile before denying newly seen identities.
    for (const profile of before.profiles) {
      if (profile.role || profile.mergedInto || profile.id === "gateway-owner")
        continue;
      await mutationThenObserve(
        () =>
          this.acting(actor, credential, async (gateway) => {
            const current = await readState(gateway);
            if (
              current.revision !== before.revision ||
              !isDeepStrictEqual(
                current.profiles.find((item) => item.id === profile.id),
                profile,
              )
            )
              throw new NativeFailure("revision_conflict");
            await gateway.mutate("users.setRole", {
              profileId: profile.id,
              role: roles.default,
            });
          }),
        async () => {
          if (
            (await observe()).profiles.find((item) => item.id === profile.id)
              ?.role !== roles.default
          )
            throw new NativeFailure("outcome_unknown");
        },
      );
    }
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = await readState(gateway);
          if (current.revision !== before.revision)
            throw new NativeFailure("revision_conflict");
          const grants: Record<string, string[]> = {};
          for (const profile of current.profiles) {
            if (
              !roles.definitions[profile.role ?? ""]?.scopes.includes(
                "operator.admin",
              )
            )
              continue;
            for (const identity of profile.emails) {
              const existing =
                current.config.gateway.auth.identityScopes[identity];
              if (existing?.includes("operator.admin"))
                grants[identity] = [
                  ...new Set([...existing, ...identityScopes]),
                ];
            }
          }
          await patch(gateway, current.revision, {
            gateway: {
              roles: {
                default: pendingRole,
                definitions: { [pendingRole]: pendingPolicy },
              },
              auth: { identityScopes: grants },
            },
          });
        }),
      async () => {
        requireTeam(await observe());
      },
    );
  }

  private async enrichName(
    actor: NativeActor,
    credential: string,
    person: Pick<User, "identity" | "name">,
  ) {
    const name = z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) =>
        [...value].every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      )
      .safeParse(person.name);
    if (!name.success) throw new NativeFailure("invalid_response");
    let expectedName = name.data;
    const observe = () => this.acting(actor, credential, readState);
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = profileFor(
            (await readState(gateway)).profiles,
            person.identity,
          );
          if (!current) throw new NativeFailure("access_denied");
          const existing = current.displayName?.trim();
          if (
            existing &&
            ![
              person.identity,
              current.id,
              person.identity.replace(/^clawscarf:/, ""),
            ].includes(existing)
          ) {
            expectedName = existing;
            return;
          }
          await gateway.mutate("users.setDisplayName", {
            profileId: current.id,
            displayName: name.data,
          });
        }),
      async () => {
        const current = profileFor((await observe()).profiles, person.identity);
        if (current?.displayName?.trim() !== expectedName)
          throw new NativeFailure("outcome_unknown");
      },
    );
  }

  async enroll(
    actor: NativeActor,
    credential: string,
    person: Pick<User, "identity" | "name">,
    targetCredential: string,
  ) {
    const observe = () => this.acting(actor, credential, readState);
    const before = await observe();
    requireTeam(before);
    const memberPolicy = before.config.gateway.roles.definitions.member;
    if (!memberPolicy || memberPolicy.scopes.includes("operator.admin"))
      throw new NativeFailure("setup_required");
    const observeReadGrant = async () => {
      const current = await observe();
      requireTeam(current);
      if (
        !current.config.gateway.auth.trustedProxy.allowUsers.includes(
          person.identity,
        ) ||
        !isDeepStrictEqual(
          current.config.gateway.auth.identityScopes[person.identity],
          ["operator.read"],
        )
      )
        throw new NativeFailure("outcome_unknown");
    };
    // Rejoining profiles can retain old authority. First cap this identity before
    // using the private enrollment credential, including when a profile exists.
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = await readState(gateway);
          requireTeam(current);
          if (current.revision !== before.revision)
            throw new NativeFailure("revision_conflict");
          await patch(
            gateway,
            current.revision,
            {
              gateway: {
                auth: {
                  trustedProxy: {
                    allowUsers: [
                      ...new Set([
                        ...current.config.gateway.auth.trustedProxy.allowUsers,
                        person.identity,
                      ]),
                    ],
                  },
                  identityScopes: { [person.identity]: ["operator.read"] },
                },
              },
            },
            [`gateway.auth.identityScopes.${person.identity}`],
          );
        }),
      observeReadGrant,
    );
    await observeEnrollmentConnection(observeReadGrant, () =>
      this.connect(this.gatewayOptions(targetCredential, []), () =>
        Promise.resolve(undefined),
      ),
    );
    const enrolled = await observe();
    const profile = profileFor(enrolled.profiles, person.identity);
    if (!profile) throw new NativeFailure("outcome_unknown");
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = await readState(gateway);
          requireTeam(current);
          if (
            !isDeepStrictEqual(
              current.config.gateway.roles.definitions.member,
              memberPolicy,
            ) ||
            !isDeepStrictEqual(
              profileFor(current.profiles, person.identity),
              profile,
            )
          )
            throw new NativeFailure("revision_conflict");
          await gateway.mutate("users.setRole", {
            profileId: profile.id,
            role: "member",
          });
        }),
      async () => {
        if (
          profileFor((await observe()).profiles, person.identity)?.role !==
          "member"
        )
          throw new NativeFailure("outcome_unknown");
      },
    );
    await this.enrichName(actor, credential, person);
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = await readState(gateway);
          requireTeam(current);
          if (
            profileFor(current.profiles, person.identity)?.role !== "member" ||
            !isDeepStrictEqual(
              current.config.gateway.roles.definitions.member,
              memberPolicy,
            )
          )
            throw new NativeFailure("revision_conflict");
          await patch(
            gateway,
            current.revision,
            {
              gateway: {
                auth: { identityScopes: { [person.identity]: identityScopes } },
              },
            },
            [`gateway.auth.identityScopes.${person.identity}`],
          );
        }),
      () =>
        this.connect(
          this.gatewayOptions(targetCredential, []),
          async (gateway) => {
            const target = await self(gateway, person.identity);
            const expected = identityScopes.filter(
              (scope) =>
                memberPolicy.scopes.includes(scope) ||
                (memberPolicy.scopes.includes("operator.write") &&
                  ["operator.read", "operator.talk"].includes(scope)),
            );
            if (
              target.id !== profile.id ||
              target.role !== "member" ||
              !isDeepStrictEqual([...gateway.scopes].sort(), expected.sort())
            )
              throw new NativeFailure("outcome_unknown");
          },
        ),
    );
  }

  async revoke(
    actor: NativeActor,
    credential: string,
    identity: string,
    eligibleIdentities: readonly string[],
  ) {
    const observe = () => this.acting(actor, credential, readState);
    await mutationThenObserve(
      () =>
        this.acting(actor, credential, async (gateway) => {
          const current = await readState(gateway);
          requireTeam(current);
          if (
            !eligibleIdentities.some(
              (candidate) =>
                candidate !== identity && isAdministrator(current, candidate),
            )
          )
            throw new NativeFailure("last_administrator");
          await patch(
            gateway,
            current.revision,
            {
              gateway: {
                auth: {
                  trustedProxy: {
                    allowUsers:
                      current.config.gateway.auth.trustedProxy.allowUsers.filter(
                        (item) => item !== identity,
                      ),
                  },
                  identityScopes: { [identity]: [] },
                },
              },
            },
            [
              "gateway.auth.trustedProxy.allowUsers",
              `gateway.auth.identityScopes.${identity}`,
            ],
          );
        }),
      async () => {
        if (identity === actor.identity) {
          try {
            await observe();
          } catch (error) {
            if (
              error instanceof NativeFailure &&
              error.code === "access_denied"
            )
              return;
            throw error;
          }
          throw new NativeFailure("outcome_unknown");
        }
        const current = await observe();
        if (
          current.config.gateway.auth.trustedProxy.allowUsers.includes(
            identity,
          ) ||
          current.config.gateway.auth.identityScopes[identity]?.length
        )
          throw new NativeFailure("outcome_unknown");
      },
    );
  }
}

function isAdministrator(state: NativeState, identity: string): boolean {
  const profile = profileFor(state.profiles, identity);
  const { roles, auth } = state.config.gateway;
  return (
    !!profile &&
    !!roles.definitions[profile.role ?? roles.default]?.scopes.includes(
      "operator.admin",
    ) &&
    !!auth.identityScopes[identity]?.includes("operator.admin") &&
    auth.trustedProxy.allowUsers.includes(identity)
  );
}

async function readAfterReload<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (
        !(error instanceof NativeFailure) ||
        attempt >= 11 ||
        !["unavailable", "outcome_unknown", "revision_conflict"].includes(
          error.code,
        )
      )
        throw error;
      await delay(750);
    }
  }
}

/** A native reload can close the writer. Observe the durable result, never replay it. */
async function mutationThenObserve(
  mutate: () => Promise<void>,
  observe: () => Promise<void>,
) {
  try {
    await mutate();
  } catch (error) {
    if (!(error instanceof NativeFailure) || error.code !== "outcome_unknown")
      throw error;
  }
  await readAfterReload(observe);
}
