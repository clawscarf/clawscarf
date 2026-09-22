import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { companionConfiguration, type LocalInput } from "./configuration.js";
import { writePrivate, ensurePrivateFile } from "./state.js";

/** Only the companion receives management credentials; model and native containers do not. */
export async function prepareCloudManagement(
  directory: string,
  input: LocalInput,
  replace = false,
) {
  const publish = replace ? writePrivate : ensurePrivateFile;
  if (!input.cloudServices?.length) return;
  const root = join(directory, "private/cloud-services");
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const target of input.cloudServices) {
    const secret = (await readFile(target.managementKeyFile, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret))
      throw Error("Invalid Cloud management credential.");
    await publish(join(root, target.id + ".key"), secret);
  }
}

export async function applyCloudManagement(
  directory: string,
  input: LocalInput,
) {
  await prepareCloudManagement(directory, input, true);
  await writePrivate(
    join(directory, "private/companion.json"),
    JSON.stringify(companionConfiguration(input)),
  );
  const file = join(directory, "compose.json");
  const config = z
    .looseObject({
      services: z.looseObject({
        companion: z.looseObject({ volumes: z.array(z.string()) }),
      }),
    })
    .parse(JSON.parse(await readFile(file, "utf8")));
  const mount =
    join(directory, "private/cloud-services") +
    ":/run/clawscarf/cloud-services:ro";
  config.services.companion.volumes = config.services.companion.volumes.filter(
    (value) => value !== mount,
  );
  if (input.cloudServices?.length)
    config.services.companion.volumes.push(mount);
  await writePrivate(file, JSON.stringify(config));
}
