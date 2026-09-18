import { writeRuntimePackage } from "./release/runtime-package.js";

await writeRuntimePackage(
  process.cwd(),
  "dist",
  [
    "apps/companion/entry.js",
    "services/access/runtime/migrate.js",
    "services/access/runtime/setup.js",
  ],
  { name: "clawscarf-companion" },
);
