import { readFileSync } from "node:fs";
import { initializeHome } from "./initialize.js";
await initializeHome(
  "/home/node",
  JSON.parse(readFileSync(0, "utf8")),
  1000,
  1000,
);
