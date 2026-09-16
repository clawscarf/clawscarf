import { z } from "zod";
import type { InstallationConfiguration } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { absolute, inputFile } from "../inputs.js";
import { openPack } from "../../../packs/source.js";

export async function collectPacks(
  ui: InstallerPrompts,
  models: InstallationConfiguration["models"] | undefined,
  connections: InstallationConfiguration["connections"],
  current: Pick<InstallationConfiguration, "packs" | "packOperator">,
) {
  const packs = structuredClone(current.packs);
  if (packs.length) {
    const action = await ui.select("Existing packs", [
      { value: "keep", label: "Keep selections" },
      { value: "add", label: "Add a pack" },
      { value: "remove", label: "Remove selected packs" },
    ]);
    if (action === "keep")
      return {
        packs,
        ...(current.packOperator ? { packOperator: current.packOperator } : {}),
      };
    if (action === "remove") {
      const removed = await ui.multiselect(
        "Remove packs",
        packs.map((pack, index) => ({
          value: String(index),
          label: pack.members.join(", "),
        })),
      );
      const retained = packs.filter(
        (_pack, index) => !removed.includes(String(index)),
      );
      return retained.length
        ? {
            packs: retained,
            ...(current.packOperator
              ? { packOperator: current.packOperator }
              : {}),
          }
        : { packs: [] };
    }
  }
  const selected = new Set(packs.flatMap((pack) => pack.members));
  while (
    packs.length < 32 &&
    (await ui.confirm(
      packs.length
        ? "Add another pack?"
        : "Install a pack? (experimental native Claws)",
    ))
  ) {
    const directory = absolute(await ui.text("Pack directory"));
    const pack = await openPack(directory);
    const eligible = pack.manifest.members.filter(
      (member) =>
        !selected.has(member.id) &&
        (member.requirements.model === "none" || Boolean(models)) &&
        (!member.requirements.connections.length ||
          connections.mode !== "disabled"),
    );
    if (!eligible.length) {
      ui.note(
        "No unselected members meet the model and Connections prerequisites. Choose another pack or configure its prerequisites first.",
        "Pack unavailable",
      );
      continue;
    }
    const members = z
      .array(z.enum(eligible.map((member) => member.id)))
      .min(1)
      .parse(
        await ui.multiselect(
          "Pack agents",
          eligible.map((member) => ({ value: member.id, label: member.id })),
        ),
      );
    const needsConnections = eligible.some(
      (member) =>
        members.includes(member.id) && member.requirements.connections.length,
    );
    const bindingsFile = needsConnections
      ? await inputFile(ui, "Connected-account bindings file", true)
      : undefined;
    packs.push({
      directory,
      members,
      ...(bindingsFile ? { bindingsFile } : {}),
    });
    members.forEach((member) => selected.add(member));
  }
  if (!packs.length) return { packs };
  const pythonExecutable = absolute(
    await ui.text(
      "Python executable with the pinned OpenShell SDK",
      current.packOperator?.pythonExecutable,
    ),
  );
  return {
    packs,
    packOperator: { pythonExecutable, experimentalClaws: true as const },
  };
}
