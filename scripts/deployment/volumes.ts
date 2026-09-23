import { OperatorError } from "../errors.js";
import { run } from "./process.js";
export async function ensureOwnedVolume(
  name: string,
  ownerId: string,
  driverOptions: Record<string, string> = {},
  command: typeof run = run,
) {
  const listed = (
    await command("docker", ["volume", "ls", "--format", "{{.Name}}"])
  )
    .trim()
    .split("\n");
  if (!listed.includes(name))
    await command("docker", [
      "volume",
      "create",
      "--label",
      `clawscarf.installation=${ownerId}`,
      ...Object.entries(driverOptions).flatMap(([key, value]) => [
        "--opt",
        `${key}=${value}`,
      ]),
      name,
    ]);
  const label = (
    await command("docker", [
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
  if (Object.keys(driverOptions).length) {
    const actual = await command("docker", [
      "volume",
      "inspect",
      name,
      "--format",
      [
        "{{.Driver}}",
        ...Object.keys(driverOptions).map(
          (key) => `{{index .Options ${JSON.stringify(key)}}}`,
        ),
      ].join("|"),
    ]);
    if (actual.trim() !== ["local", ...Object.values(driverOptions)].join("|"))
      throw new OperatorError(
        "The installation volume has unexpected mount options.",
      );
  }
}
