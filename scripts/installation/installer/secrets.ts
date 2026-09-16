import { InstallationError } from "../errors.js";
import { SetupInputs } from "../save.js";
import type { InstallerPrompts } from "./prompts.js";
import { inputFile } from "./inputs.js";

export async function secretInput(
  ui: InstallerPrompts,
  inputs: SetupInputs,
  message: string,
  name: string,
  current?: string,
) {
  const mode = await ui.select(
    message,
    [
      ...(current ? [{ value: "keep", label: "Keep current value" }] : []),
      { value: "paste", label: "Paste secret (hidden)" },
      { value: "file", label: "Import private file" },
    ],
    current ? "keep" : "paste",
  );
  if (mode === "keep" && current) return current;
  if (mode === "file") return inputFile(ui, `${message} file`, true);
  if (mode !== "paste")
    throw new InstallationError(
      "invalid_configuration",
      "Select a secret input method.",
    );
  return inputs.set(name, await ui.password(message));
}
