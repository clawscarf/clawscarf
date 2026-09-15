import { readFileSync } from "node:fs";
import { initializeWorkerHome } from "./initialize-worker.js";
await initializeWorkerHome(
  "/home/node",
  JSON.parse(readFileSync(0, "utf8")),
  1000,
  1000,
);
