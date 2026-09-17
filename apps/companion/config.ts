import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readConfiguration } from "../../services/access/runtime/config.js";
const schema = z
  .object({
    accessConfigurationFile: z.string().min(1),
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
    connections: z
      .object({
        projectId: z.string().min(1),
        apiKeyFile: z.string().min(1),
        catalogDirectory: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => !(value.connections && value.cloudConnections),
    "Choose one Connections backend.",
  );
export async function readCompanionConfiguration(path: string) {
  const config = schema.parse(JSON.parse(await readFile(path, "utf8")));
  return {
    ...(config.cloudConnections
      ? { cloudConnections: config.cloudConnections }
      : {}),
    access: await readConfiguration(config.accessConfigurationFile),
    ...(config.connections ? { connections: config.connections } : {}),
  };
}
export type CompanionConfiguration = Awaited<
  ReturnType<typeof readCompanionConfiguration>
>;
