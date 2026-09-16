import type { InstallationDraft } from "./configuration.js";
import { openPack } from "../packs/source.js";

/** Draft feedback only; preview/apply still revalidate real inputs and native state. */
export async function packRequirements(config: InstallationDraft) {
  const issues: string[] = [];
  const members = new Set<string>();
  for (const selected of config.packs) {
    const pack = await openPack(selected.directory);
    for (const id of selected.members) {
      const member = pack.manifest.members.find((entry) => entry.id === id);
      if (!member || members.has(id)) {
        issues.push(`Pack agent ${id} must exist and be selected only once.`);
        continue;
      }
      members.add(id);
      if (member.requirements.model !== "none" && !config.models)
        issues.push(`${id} requires Models to be configured.`);
      if (
        member.requirements.connections.length &&
        (config.connections.mode === "disabled" || !selected.bindingsFile)
      )
        issues.push(`${id} requires Connections and account bindings.`);
    }
  }
  return issues;
}
