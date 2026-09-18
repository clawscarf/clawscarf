import { z } from "zod";
import { resourceNames, type LocalState } from "./state.js";
import { LocalSetupError, run } from "./process.js";

const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const containerId = z.string().regex(/^[a-f0-9]{64}$/);

/** Read actual Docker-driver identity/image/storage before admitting application access. */
export async function verifyRuntimeBinding(
  state: LocalState,
  target: { id: string; name: string },
  command: typeof run = run,
) {
  const names = resourceNames(state);
  if (target.name !== names.sandbox || !z.uuid().safeParse(target.id).success)
    throw new LocalSetupError(
      "runtime_binding_changed",
      "The selected runtime does not belong to this installation.",
    );
  try {
    const ids = (
      await command("docker", [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `label=openshell.ai/sandbox-id=${target.id}`,
      ])
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    const parsed = z.array(containerId).parse(ids);
    if (parsed.length !== 1) changed();
    const id = parsed[0];
    if (!id) changed();
    const actual = z
      .object({
        Id: containerId,
        Image: imageId,
        Labels: z.record(z.string(), z.string()),
        Mounts: z.array(
          z.object({
            Type: z.string(),
            Name: z.string().optional(),
            Destination: z.string(),
            RW: z.boolean(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await command("docker", [
            "container",
            "inspect",
            "--format",
            '{"Id":{{json .Id}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}}}',
            id,
          ]),
        ),
      );
    const expectedImage = imageId.parse(
      (
        await command("docker", [
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          state.input.runtimeImage,
        ])
      ).trim(),
    );
    const labels = {
      "openshell.ai/managed-by": "openshell",
      "openshell.ai/sandbox-id": target.id,
      "openshell.ai/sandbox-name": target.name,
      "openshell.ai/sandbox-namespace": names.sandbox,
      "openshell.ai/sandbox-workspace": "default",
    };
    const homes = actual.Mounts.filter(
      (mount) => mount.Destination === "/home/node",
    );
    const home = homes[0];
    if (
      actual.Id !== id ||
      actual.Image !== expectedImage ||
      Object.entries(labels).some(
        ([key, value]) => actual.Labels[key] !== value,
      ) ||
      homes.length !== 1 ||
      actual.Mounts.some((mount) =>
        mount.Destination.startsWith("/home/node/"),
      ) ||
      home?.Type !== "volume" ||
      home.Name !== names.volume ||
      !home.RW
    )
      changed();
    const volume = z
      .object({
        Name: z.string(),
        Labels: z.record(z.string(), z.string()).nullable(),
      })
      .parse(
        JSON.parse(
          await command("docker", [
            "volume",
            "inspect",
            "--format",
            '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
            names.volume,
          ]),
        ),
      );
    if (
      volume.Name !== names.volume ||
      volume.Labels?.["clawscarf.installation"] !== state.ownerId
    )
      changed();
    return { containerId: actual.Id, imageId: actual.Image };
  } catch (error) {
    if (
      error instanceof LocalSetupError &&
      error.code === "runtime_binding_changed"
    )
      throw error;
    throw new LocalSetupError(
      "runtime_binding_unavailable",
      "The runtime image and storage could not be verified. Inspect Docker before continuing.",
    );
  }
}

function changed(): never {
  throw new LocalSetupError(
    "runtime_binding_changed",
    "The runtime container, image or home volume differs from this installation. Inspect its ownership before continuing.",
  );
}
