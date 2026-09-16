import { fileURLToPath } from "node:url";
import { stageOperatorAssets } from "./release/operator.js";

await stageOperatorAssets(fileURLToPath(new URL("..", import.meta.url)));
