import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readConfiguration } from "../../services/access/runtime/config.js";
const schema = z
  .object({
    accessConfigurationFile: z.string().min(1),
    connections: z
      .object({
        projectId: z.string().min(1),
        apiKeyFile: z.string().min(1),
        catalogDirectory: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export async function readCompanionConfiguration(path: string) {
  const config = schema.parse(JSON.parse(await readFile(path, "utf8")));
  return {
    access: await readConfiguration(config.accessConfigurationFile),
    ...(config.connections ? { connections: config.connections } : {}),
  };
}
export type CompanionConfiguration = Awaited<
  ReturnType<typeof readCompanionConfiguration>
>;
