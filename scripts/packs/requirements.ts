import { verifyConnections } from "./connections.js";
import type { NativeClaws } from "./native.js";
import type { Member, Pack, PackPlan } from "./model.js";
export async function requirements(
  pack: Pack,
  member: Member,
  native: NativeClaws,
  bindingsFile?: string,
  sourceRoot = "",
): Promise<PackPlan["requirements"]> {
  for (const binary of pack.execution.binaries) await native.binary(binary);
  const network = await native.network(pack.execution.network);
  const model =
    member.requirements.model === "configured-default"
      ? await native.defaultModel()
      : null;
  const connections = await verifyConnections(
    member,
    native,
    sourceRoot,
    bindingsFile,
  );
  return { model, connections, network };
}
