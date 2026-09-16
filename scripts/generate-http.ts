import { mkdtemp, cp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";

// Generate the upstream transport once, independently of any service contract.
const temporary = await mkdtemp(join(tmpdir(), "clawscarf-http-"));
try {
  await createClient({
    input: {
      openapi: "3.1.0",
      info: { title: "HTTP", version: "1" },
      paths: {},
    },
    output: temporary,
    plugins: ["@hey-api/client-fetch"],
  });
  await rm("generated/http", { recursive: true, force: true });
  await mkdir("generated/http", { recursive: true });
  await cp(
    fileURLToPath(
      new URL(
        "LICENSE.md",
        import.meta.resolve("@hey-api/openapi-ts/package.json"),
      ),
    ),
    "generated/http/LICENSE.md",
  );
  for (const directory of ["client", "core"])
    await cp(join(temporary, directory), join("generated/http", directory), {
      recursive: true,
    });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
