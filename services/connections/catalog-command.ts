import { Command } from "commander";
import { Pool } from "pg";
import { PostgresCatalogPublicationStore } from "./repo/catalog-publication.js";
import { transaction } from "./repo/database.js";
import { openConnectorCatalog } from "./providers/catalog/provider.js";
import { CatalogPublicationService } from "./service/catalog-publication.js";

const program = new Command("connections-publication").description(
  "Publish a reviewed connection catalog using the operator database credential.",
);
program
  .command("publish")
  .requiredOption("--catalog <directory>")
  .requiredOption(
    "--expected-version <version>",
    "current sha256 version, or none for initial publication",
  )
  .option("--dry-run", undefined, false)
  .action(
    async (options: {
      catalog: string;
      expectedVersion: string;
      dryRun: boolean;
    }) => {
      const databaseUrl = process.env.CLAWSCARF_DATABASE_URL;
      if (!databaseUrl) throw Error("Set CLAWSCARF_DATABASE_URL.");
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const catalog = await openConnectorCatalog(options.catalog, {
          verifyDetails: true,
        });
        const service = new CatalogPublicationService({
          transaction: (work) =>
            transaction(pool, (client) =>
              work(new PostgresCatalogPublicationStore(client)),
            ),
        });
        const result = await service.publish(
          catalog,
          options.expectedVersion === "none" ? null : options.expectedVersion,
          options.dryRun,
        );
        process.stdout.write(JSON.stringify(result) + "\n");
      } finally {
        await pool.end();
      }
    },
  );
await program.parseAsync();
