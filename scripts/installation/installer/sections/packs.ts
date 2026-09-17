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
  available: readonly { id: string; directory: string }[] = [],
) {
  const packs = structuredClone(current.packs);
  let keep = false;
  if (packs.length) {
    const action = await ui.select("Existing packs", [
      { value: "keep", label: "Keep selections" },
      { value: "add", label: "Add a pack" },
      { value: "remove", label: "Remove selected packs" },
    ]);
    keep = action === "keep";
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
    !keep &&
    packs.length < 32 &&
    (await ui.confirm(
      packs.length
        ? "Add another pack?"
        : "Install a pack? (experimental native Claws)",
    ))
  ) {
    const directory = available.length
      ? await ui.select(
          "Pack",
          available.map((pack) => ({ value: pack.directory, label: pack.id })),
        )
      : absolute(await ui.text("Pack directory"));
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
  return collectPackInputs(ui, { ...current, packs });
}

export async function collectPackInputs(
  ui: InstallerPrompts,
  current: Pick<InstallationConfiguration, "packs" | "packOperator">,
) {
  const packs = structuredClone(current.packs);
  if (!packs.length) return { packs };
  for (const selection of packs) {
    const pack = await openPack(selection.directory);
    if (
      !selection.bindingsFile &&
      pack.manifest.members.some(
        (member) =>
          selection.members.includes(member.id) &&
          member.requirements.connections.length,
      )
    )
      selection.bindingsFile = await inputFile(
        ui,
        "Connected-account bindings file",
        true,
      );
  }
  const pythonExecutable =
    current.packOperator?.pythonExecutable ??
    absolute(
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
