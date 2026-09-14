import { buildConnectorCatalog } from "../../services/connections/providers/catalog/import-artifacts.js";
import { FileConnectorCatalog } from "../../services/connections/providers/catalog/provider.js";
import {
  readCatalogDetail,
  readCatalogIndex,
} from "../../services/connections/providers/catalog/validation.js";

/** Synthetic provider data goes through the production importer and catalog reader. */
export function connectionCatalogFiles(
  options: { serviceName?: string; retired?: boolean; toolkit?: string } = {},
) {
  return buildConnectorCatalog(
    {
      source: {
        repository: "https://example.test/catalog",
        revision: "1".repeat(40),
        paths: ["manifest.json"],
      },
      connectors: options.retired
        ? []
        : [
            {
              id: "test",
              toolkitSlug: options.toolkit ?? "test",
              name: options.serviceName ?? "Test",
              description: "Fixture connector",
              category: "Tests",
              iconUrl: "https://example.test/icon",
              auth: { kind: "managed" },
            },
          ],
    },
    new Map([
      [
        "test",
        [
          {
            slug: "TEST_CALL",
            name: "Call",
            description: "Raw provider guidance",
            version: "20260910",
            input_parameters: { type: "object", required: ["ignored"] },
            output_parameters: { type: "string" },
          },
        ],
      ],
    ]),
  );
}

export function connectionCatalog(
  options: { serviceName?: string; retired?: boolean; toolkit?: string } = {},
) {
  const files = connectionCatalogFiles(options);
  const read = (path: string): unknown => {
    const contents = files.get(path);
    if (!contents) throw Error(`Missing catalog fixture ${path}`);
    return JSON.parse(contents);
  };
  return new FileConnectorCatalog(readCatalogIndex(read("index.json")), (id) =>
    Promise.resolve(readCatalogDetail(read(`${id}.json`))),
  );
}
