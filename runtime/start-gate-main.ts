import { waitForStartGate } from "./start-gate.js";

await waitForStartGate(process.env["CLAWSCARF_START_GATE"] ?? "");
