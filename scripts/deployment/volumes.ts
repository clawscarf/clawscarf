import { OperatorError } from "../errors.js";
import { run } from "./process.js";
export async function ensureOwnedVolume(name: string, ownerId: string) {
  const listed = (
    await run("docker", ["volume", "ls", "--format", "{{.Name}}"])
  )
    .trim()
    .split("\n");
  if (!listed.includes(name))
    await run("docker", [
      "volume",
      "create",
      "--label",
      `clawscarf.installation=${ownerId}`,
      name,
    ]);
  const label = (
    await run("docker", [
      "volume",
      "inspect",
      name,
      "--format",
      '{{index .Labels "clawscarf.installation"}}',
    ])
  ).trim();
  if (label !== ownerId)
    throw new OperatorError(
      "A volume with this name belongs to a different installation.",
    );
}
