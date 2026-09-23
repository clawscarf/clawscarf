import { cloudServicesSchema } from "../../services/cloud/management/config.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readConfiguration } from "../../services/access/runtime/config.js";
const schema = z
  .object({
    accessConfigurationFile: z.string().min(1),
    cloudServices: cloudServicesSchema.optional(),
    cloudConnections: z
      .strictObject({
        url: z.url().refine((value) => {
          const u = new URL(value);
          return (
            !u.username &&
            !u.password &&
            u.pathname === "/" &&
            !u.search &&
            !u.hash &&
            (u.protocol === "https:" ||
              (u.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
          );
        }),
        managementKeyFile: z.string().min(1),
      })
      .optional(),
  })
  .strict();
export async function readCompanionConfiguration(path: string) {
  const config = schema.parse(JSON.parse(await readFile(path, "utf8")));
  return {
    cloudServices: config.cloudServices ?? [],
    ...(config.cloudConnections
      ? { cloudConnections: config.cloudConnections }
      : {}),
    access: await readConfiguration(config.accessConfigurationFile),
  };
}
export type CompanionConfiguration = Awaited<
  ReturnType<typeof readCompanionConfiguration>
>;
