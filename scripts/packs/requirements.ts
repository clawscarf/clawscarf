import { access, constants, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { createClient } from "../../services/connections/generated/client/client/index.js";
import { getConnection } from "../../services/connections/generated/client/sdk.gen.js";
import type { NativeClaws } from "./native.js";
import type { Member, Pack, PackPlan } from "./model.js";

const bindingsSchema = z.strictObject({
  origin: z.url(),
  sessionFile: z.string(),
  connections: z.record(z.string(), z.uuid()),
});
export async function requirements(
  pack: Pack,
  member: Member,
  native: NativeClaws,
  bindingsFile?: string,
): Promise<PackPlan["requirements"]> {
  for (const binary of pack.execution.binaries) {
    let found = false;
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      try {
        await access(join(directory, binary), constants.X_OK);
        found = true;
        break;
      } catch {
        continue;
      }
    }
    if (!found) throw Error(`Required binary is unavailable: ${binary}`);
  }
  if (pack.execution.network.length)
    throw Error(
      "This pack requires a runtime network-policy binding; this local lifecycle command cannot verify that policy.",
    );
  const model =
    member.requirements.model === "configured-default"
      ? await native.defaultModel()
      : null;
  const connections: PackPlan["requirements"]["connections"] = [];
  if (member.requirements.connections.length) {
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
      origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
      throw Error("Connection bindings require HTTPS or a loopback origin.");
    const cookie = (await readFile(bindings.sessionFile, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(cookie)) throw Error("Invalid session file.");
    const client = createClient({
      baseUrl: origin.origin,
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
      if (
        data.connectorId !== required.connectorId ||
        data.state !== "connected" ||
        (data.grant.mode === "selected" &&
          !data.grant.agentIds.includes(member.id))
      )
        throw Error(
          `Connection binding is unavailable for ${member.id}: ${required.slot}`,
        );
      connections.push({
        slot: required.slot,
        connectionId: id,
        revision: data.revision,
      });
    }
  }
  return { model, connections };
}
