import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import type { ConnectorJson } from "../../types/catalog.js";
import { catalogDigest, type ConnectorManifest } from "./artifact.js";
import { readCatalogIndex, readConnectorManifest } from "./validation.js";
import {
  checkConnectorCatalogRetirement,
  readConnectorCatalogUsage,
} from "./retirement.js";
import {
  buildConnectorCatalog,
  catalogDifference,
  readJsonFile,
  readRawCatalog,
  writeCatalog,
} from "./import-artifacts.js";
import { fetchConnectorTools } from "./import-provider.js";

interface CatalogOptions {
  manifest: string;
  output: string;
}
interface RefreshOptions {
  apiKeyFile?: string;
  apiBaseUrl: string;
  snapshots?: string;
  dryRun: boolean;
}
interface AddOptions {
  name: string;
  description: string;
  category: string;
  iconUrl: string;
  toolkit?: string;
  authScheme?: string;
  dryRun: boolean;
}

export function connectorCatalogCommand(): Command {
  const defaults = resolve(import.meta.dirname, "../../catalog");
  const command = new Command("connectors-catalog")
    .description(
      "Manage the reviewed connector catalog and untouched provider schema hints.",
    )
    .option(
      "--manifest <path>",
      "connector metadata manifest",
      join(defaults, "manifest.json"),
    )
    .option(
      "--output <directory>",
      "generated catalog directory",
      resolve(".local/connections/catalog"),
    );
  const options = (): CatalogOptions => command.opts<CatalogOptions>();
  const manifest = async (): Promise<ConnectorManifest> =>
    readConnectorManifest(
      await readJsonFile(options().manifest, 2 * 1024 * 1024),
    );
  command
    .command("refresh")
    .description(
      "Import every selected toolkit; replace artifacts only after complete validation.",
    )
    .option(
      "--api-key-file <path>",
      "dedicated catalog/provider credential file",
    )
    .option(
      "--api-base-url <url>",
      "provider catalog API",
      "https://backend.composio.dev",
    )
    .option(
      "--snapshots <directory>",
      "rebuild from exact raw action-array snapshots instead of network",
    )
    .option("--dry-run", "report changed files without writing", false)
    .action(async (input: RefreshOptions) => {
      const selected = await manifest();
      let sources: Map<string, ConnectorJson[]>;
      if (input.snapshots)
        sources = await readRawCatalog(input.snapshots, selected);
      else {
        const key = input.apiKeyFile
          ? (await readFile(input.apiKeyFile, "utf8")).trim()
          : process.env.CLAWSCARF_COMPOSIO_API_KEY;
        if (!key)
          throw Error(
            "Set CLAWSCARF_COMPOSIO_API_KEY or --api-key-file to import provider schemas.",
          );
        sources = new Map<string, ConnectorJson[]>();
        for (const connector of selected.connectors)
          sources.set(
            connector.id,
            await fetchConnectorTools({
              toolkit: connector.toolkitSlug,
              apiKey: key,
              baseUrl: input.apiBaseUrl,
            }),
          );
      }
      const files = buildConnectorCatalog(selected, sources);
      const changes = await catalogDifference(options().output, files);
      if (!input.dryRun) await writeCatalog(options().output, files);
      console.log(
        JSON.stringify(
          {
            manifestDigest: catalogDigest(selected),
            changedFiles: changes,
            written: !input.dryRun,
          },
          null,
          2,
        ),
      );
    });
  command
    .command("check")
    .description(
      "Verify generated artifacts against the manifest and stored raw provider snapshots; no network.",
    )
    .option(
      "--manifest-only",
      "validate source metadata without claiming generated catalog readiness",
      false,
    )
    .action(async (input: { manifestOnly: boolean }) => {
      const selected = await manifest();
      if (!input.manifestOnly) {
        const sources = await readRawCatalog(
          join(options().output, "raw"),
          selected,
        );
        const differences = await catalogDifference(
          options().output,
          buildConnectorCatalog(selected, sources),
        );
        if (differences.length)
          throw Error(`Connector catalog drift: ${differences.join(", ")}`);
      }
      console.log(
        JSON.stringify({
          connectors: selected.connectors.length,
          manifestDigest: catalogDigest(selected),
          scope: input.manifestOnly ? "manifest" : "complete-catalog",
        }),
      );
    });
  command
    .command("preflight")
    .description(
      "Check proposed removals against an operator-supplied usage snapshot; no deployment.",
    )
    .requiredOption(
      "--usage <path>",
      "current catalog resource-reference snapshot",
    )
    .action(async (input: { usage: string }) => {
      const selected = await manifest();
      const current = readCatalogIndex(
        await readJsonFile(join(options().output, "index.json")),
      );
      const usage = readConnectorCatalogUsage(await readJsonFile(input.usage));
      const result = checkConnectorCatalogRetirement({
        currentVersion: current.version,
        currentConnectorIds: current.connectors.map(
          (entry) => entry.metadata.id,
        ),
        nextConnectorIds: selected.connectors.map((entry) => entry.id),
        usage,
      });
      console.log(
        JSON.stringify({ ...result, scope: "usage-snapshot" }, null, 2),
      );
      if (result.blockers.length)
        throw Error(
          "Connector catalog retirement is blocked by retained resources.",
        );
    });
  command
    .command("add <id>")
    .description(
      "Add service metadata; run refresh to import its actions before deployment.",
    )
    .requiredOption("--name <name>", "display name")
    .requiredOption("--description <text>", "service description")
    .requiredOption("--category <category>", "catalog category")
    .requiredOption("--icon-url <url>", "HTTPS service icon")
    .option("--toolkit <slug>", "provider toolkit slug; defaults to id")
    .option(
      "--auth-scheme <scheme>",
      "custom authentication scheme; absent selects managed authentication",
    )
    .option("--dry-run", "validate and print without writing", false)
    .action(async (id: string, input: AddOptions) => {
      const selected = await manifest();
      const next = readConnectorManifest({
        ...selected,
        connectors: [
          ...selected.connectors,
          {
            id,
            toolkitSlug: input.toolkit ?? id,
            name: input.name,
            description: input.description,
            category: input.category,
            iconUrl: input.iconUrl,
            auth: input.authScheme
              ? { kind: "custom", scheme: input.authScheme }
              : { kind: "managed" },
          },
        ],
      });
      await saveManifest(next, input.dryRun);
    });
  command
    .command("remove <id>")
    .description(
      "Remove source metadata; live retirement preflight must also clear active resource references.",
    )
    .option("--dry-run", "validate and print without writing", false)
    .action(async (id: string, input: { dryRun: boolean }) => {
      const selected = await manifest();
      if (!selected.connectors.some((entry) => entry.id === id))
        throw Error("Connector is not in the manifest.");
      await saveManifest(
        {
          ...selected,
          connectors: selected.connectors.filter((entry) => entry.id !== id),
        },
        input.dryRun,
      );
    });
  async function saveManifest(
    selected: ConnectorManifest,
    dryRun: boolean,
  ): Promise<void> {
    readConnectorManifest(selected);
    console.log(
      JSON.stringify({
        connectorIds: selected.connectors.map((entry) => entry.id),
        written: !dryRun,
      }),
    );
    if (!dryRun)
      await writeFile(
        options().manifest,
        `${JSON.stringify(selected, null, 2)}\n`,
      );
  }
  return command;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await connectorCatalogCommand().parseAsync();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Connector catalog command failed.",
    );
    process.exitCode = 1;
  }
}
