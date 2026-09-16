import type { InstallerPrompts } from "../prompts.js";
import { inputFile } from "../inputs.js";

export async function optionalCa(ui: InstallerPrompts, current?: string) {
  if (current) {
    const action = await ui.select(
      "Certificate authority",
      [
        { value: "keep", label: "Keep custom certificate authority" },
        { value: "replace", label: "Replace certificate authority" },
        { value: "system", label: "Use system certificate authorities" },
      ],
      "keep",
    );
    if (action === "keep") return { caFile: current };
    if (action === "system") return {};
    return { caFile: await inputFile(ui, "CA certificate file") };
  }
  return (await ui.confirm("Use a custom certificate authority?"))
    ? { caFile: await inputFile(ui, "CA certificate file") }
    : {};
}
