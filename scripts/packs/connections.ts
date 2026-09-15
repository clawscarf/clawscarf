import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import { z } from "zod";
import { createClient } from "../../services/connections/generated/client/client/index.js";
import { getConnection } from "../../services/connections/generated/client/sdk.gen.js";
import type { NativeClaws } from "./native.js";
import type { Member, PackPlan } from "./model.js";
const bindingsSchema = z.strictObject({
  origin: z.url(),
  brokerUrl: z.url(),
  sessionFile: z.string(),
  connections: z.record(z.string(), z.uuid()),
});
export async function verifyConnections(
  member: Member,
  native: NativeClaws,
  sourceRoot: string,
  bindingsFile?: string,
): Promise<PackPlan["requirements"]["connections"]> {
  const connections: PackPlan["requirements"]["connections"] = [];
  if (member.requirements.connections.length) {
    if (!member.connectionFile)
      throw Error(
        "A connection-dependent member must declare its native-owned connectionFile.",
      );
    if (!native.supportsConnectionBindings)
      throw Error(
        "Connection-dependent packs require operator-side verification; do not copy administrator sessions into this runtime.",
      );
    if (!bindingsFile)
      throw Error("This pack requires explicit connection bindings.");
    const bindings = bindingsSchema.parse(
      JSON.parse(await readFile(bindingsFile, "utf8")),
    );
    const origin = new URL(bindings.origin);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      throw Error(
        "Management origin must not contain credentials, path, query or fragment.",
      );
    if (
      origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
      throw Error("Connection bindings require HTTPS or a loopback origin.");
    const broker = await native.brokerUrl();
    if (broker !== bindings.brokerUrl.replace(/\/$/, ""))
      throw Error(
        "Connection bindings do not match the target runtime broker.",
      );
    for (const privatePath of [bindingsFile, bindings.sessionFile]) {
      const path = await realpath(privatePath);
      if (path === sourceRoot || path.startsWith(sourceRoot + sep))
        throw Error(
          "Keep connection bindings and administrator sessions outside the pack source.",
        );
    }
    const cookie = (await readFile(bindings.sessionFile, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(cookie)) throw Error("Invalid session file.");
    const client = createClient({
      baseUrl: origin.origin,
      redirect: "error",
      headers: { Cookie: `clawscarf_session=${cookie}` },
    });
    for (const required of member.requirements.connections) {
      const id = bindings.connections[required.slot];
      if (!id) throw Error(`Missing connection binding: ${required.slot}`);
      const { data } = await getConnection({
        client,
        path: { connectionId: id },
        throwOnError: true,
        signal: AbortSignal.timeout(10_000),
      });
      const account = z
        .object({
          id: z.uuid(),
          serverId: z.uuid(),
          connectorId: z.string(),
          name: z.string(),
          state: z.string(),
          revision: z.number().int(),
          grant: z.discriminatedUnion("mode", [
            z.object({ mode: z.literal("all") }),
            z.object({
              mode: z.literal("selected"),
              agentIds: z.array(z.string()),
            }),
          ]),
        })
        .parse(data);
      if (
        account.id !== id ||
        account.connectorId !== required.connectorId ||
        account.state !== "connected" ||
        (account.grant.mode === "selected" &&
          !account.grant.agentIds.includes(member.id))
      )
        throw Error(
          `Connection binding is unavailable for ${member.id}: ${required.slot}`,
        );
      if (
        connections.some(
          (connection) => connection.serverId !== account.serverId,
        )
      )
        throw Error("Pack account bindings must belong to one server.");
      connections.push({
        slot: required.slot,
        serverId: account.serverId,
        connectionId: id,
        revision: account.revision,
        name: account.name,
        connectorId: account.connectorId,
      });
    }
  }
  return connections;
}
