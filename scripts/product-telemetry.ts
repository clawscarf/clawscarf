import { randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { destinationSchema } from "./telemetry-destination.js";

const configurationSchema = destinationSchema.extend({
  installationId: z.uuid(),
});
export type ProductTelemetry = z.infer<typeof configurationSchema>;

/** Optional state for this installation only; no operator or account identifier. */
export async function prepareProductTelemetry(
  directory: string,
  environment: NodeJS.ProcessEnv = process.env,
  destinationFile = new URL("../release/telemetry.json", import.meta.url),
): Promise<ProductTelemetry | undefined> {
  if (environment.CLAWSCARF_TELEMETRY_DISABLED === "1") return undefined;
  try {
    const destination = destinationSchema
      .nullable()
      .parse(JSON.parse(await readFile(destinationFile, "utf8")));
    if (!destination) return undefined;
    const file = join(directory, "product-telemetry.json");
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ ...destination, installationId: randomUUID() }),
        );
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
    return configurationSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
}

/** Claim before delivery: repeated commands/concurrent operators cannot inflate installs. */
export async function claimSetupCompletion(directory: string) {
  try {
    const config = configurationSchema.parse(
      JSON.parse(
        await readFile(join(directory, "product-telemetry.json"), "utf8"),
      ),
    );
    const handle = await open(
      join(directory, "product-setup-reported.json"),
      "wx",
      0o600,
    );
    const milestone = {
      ...config,
      timestamp: new Date().toISOString(),
      insertId: randomUUID(),
    };
    try {
      await handle.writeFile(
        JSON.stringify({
          timestamp: milestone.timestamp,
          insertId: milestone.insertId,
        }),
      );
    } finally {
      await handle.close();
    }
    return milestone;
  } catch {
    return undefined;
  }
}

export function withProductTelemetry(
  native: ReturnType<
    typeof import("../runtime/configuration.js").initialConfiguration
  >,
  config: ProductTelemetry | undefined,
) {
  if (!config) return native;
  return {
    ...native,
    env: {
      vars: {
        CLAWSCARF_TELEMETRY_INSTALLATION_ID: config.installationId,
        CLAWSCARF_TELEMETRY_HOST: config.host,
        CLAWSCARF_TELEMETRY_PROJECT_TOKEN: config.projectToken,
      },
    },
    plugins: {
      ...native.plugins,
      entries: {
        ...native.plugins.entries,
        "clawscarf-access": {
          ...native.plugins.entries["clawscarf-access"],
          hooks: { allowConversationAccess: true, allowPromptInjection: false },
        },
      },
    },
  };
}
