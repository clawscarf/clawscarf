import { readFileSync } from "node:fs";
import { initializeBrowserState } from "./initialize-browser.js";

await initializeBrowserState(
  "/state",
  JSON.parse(readFileSync(0, "utf8")),
  1000,
  1000,
);
