# Cloud client

[openapi.json](openapi.json) is the public contract copied from
[clawscarf-cloud](https://github.com/clawscarf/clawscarf-cloud/blob/eb3f163/api/openapi.json).
It is shared by installation registration and the Connections management adapter.
The Connections plugin derives only the runtime routes for its portable SDK.

Run `pnpm cloud:generate` after updating the source contract; generated clients use
our shared HTTP transport. `pnpm codegen:check` detects local generation drift.
No cloud implementation or secret belongs here.
