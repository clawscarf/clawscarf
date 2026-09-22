# Cloud client

[openapi.json](openapi.json) is the public contract copied from
[clawscarf-cloud](https://github.com/clawscarf/clawscarf-cloud/blob/b3fa7233f5851ef4594277a035c9212d22c2a0b3/api/openapi.json).
It includes registration, Connections, billing and hosted AI. Installation registration
and the Connections management adapter consume this client. The installer also
uses owner-authorized AI enablement, catalog validation and scoped credentials.
Native purchase controls are maintained separately from registration.
The Connections plugin derives only the runtime routes for its portable SDK.

Run `pnpm cloud:generate` after updating the source contract; generated clients use
our shared HTTP transport. `pnpm codegen:check` detects local generation drift.
No cloud implementation or secret belongs here.
