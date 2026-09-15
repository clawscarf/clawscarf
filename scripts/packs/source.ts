import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  cp,
  mkdtemp,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import type { NativeClaws } from "./native.js";
import type { Member, PackPlan } from "./model.js";
import { z } from "zod";
import { join, relative, resolve, sep } from "node:path";
import { packSchema } from "./model.js";
export async function openPack(directory: string) {
  const root = await realpath(directory);
  const manifest = packSchema.parse(
    JSON.parse(await readFile(join(root, "pack.json"), "utf8")),
  );
  if (
    new Set(manifest.members.map((item) => item.id)).size !==
    manifest.members.length
  )
    throw Error("Pack member IDs must be unique.");
  for (const member of manifest.members) {
    if (
      new Set(member.requirements.connections.map((item) => item.slot)).size !==
      member.requirements.connections.length
    )
      throw Error("Connection slots must be unique within a member.");
    const source = await realpath(resolve(root, member.source));
    if (!source.startsWith(root + sep))
      throw Error("Claw source must remain inside its pack.");
  }
  const digest = createHash("sha256");
  let size = 0;
  async function visit(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      (metadata.nlink > 1 && !metadata.isDirectory())
    )
      throw Error("Pack sources cannot use linked files.");
    if (metadata.isDirectory()) {
      for (const item of (await readdir(path)).sort())
        await visit(join(path, item));
      return;
    }
    if (!metadata.isFile() || (size += metadata.size) > 8 * 1024 * 1024)
      throw Error(
        "Pack source exceeds the 8 MiB limit or is not a regular file.",
      );
    digest.update(
      JSON.stringify({
        path: relative(root, path).split(sep).join("/"),
        executable: metadata.mode & 0o111,
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      }) + "\n",
    );
  }
  await visit(root);
  return { root, manifest, digest: "sha256:" + digest.digest("hex") };
}

export async function prepareSource(
  source: Awaited<ReturnType<typeof openPack>>,
  member: Member,
  connections: PackPlan["requirements"]["connections"],
  native: NativeClaws,
  existing?: string,
) {
  if (!connections.length)
    return native.source(source.root, source.digest, existing);
  if ((await native.target()).kind !== "openshell")
    throw Error(
      "Connection file installation requires operator-side OpenShell execution.",
    );
  if (!member.connectionFile) throw Error("Connection file is not declared.");
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-bound-"));
  try {
    await cp(source.root, directory, { recursive: true });
    await writeFile(
      join(directory, member.source, member.connectionFile),
      JSON.stringify(
        {
          schemaVersion: 1,
          connections: connections.map(
            ({ slot, connectionId, name, connectorId }) => ({
              slot,
              connectionId,
              name,
              connectorId,
            }),
          ),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    const prepared = await openPack(directory);
    const target = await native.source(directory, prepared.digest, existing);
    const inspected = z
      .object({
        valid: z.literal(true),
        manifest: z.object({
          workspace: z.object({
            files: z.array(z.object({ source: z.string(), path: z.string() })),
          }),
        }),
      })
      .parse(
        await native.run([
          "claws",
          "inspect",
          join(target, member.source),
          "--json",
        ]),
      );
    if (
      !inspected.manifest.workspace.files.some(
        (file) => file.source === member.connectionFile,
      )
    )
      throw Error(
        "connectionFile must be declared in the native Claw workspace.files; its ownership cannot be inferred.",
      );
    return target;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
