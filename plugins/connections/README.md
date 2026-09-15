# Connections for ClawScarf

A native OpenClaw plugin for accounts managed by a compatible Connections broker.
It exposes only `connections_search`, `connections_describe` and `connections_call`.
The bundled [skill](skills/connections/SKILL.md) explains exact account selection,
advisory provider schemas, saved results and uncertain outcomes.

The plugin needs no RawClaw checkout, account or database. An external broker owns
account setup, credentials and grants. The runtime REST contract is in
[openapi/broker.yaml](openapi/broker.yaml); a generic HTTPS URL alone does not make
an arbitrary service compatible. No Composio project key belongs in this plugin.

## Configuration

Install the built package through OpenClaw's native plugin installation/consent
flow, then configure `plugins.entries.clawscarf-connections`:

```json
{
  "enabled": true,
  "config": {
    "brokerUrl": "https://connections.example.com",
    "credential": {
      "source": "env",
      "provider": "default",
      "id": "CLAWSCARF_CONNECTIONS_TOKEN"
    }
  }
}
```

Supply that limited server credential to the runtime through its secret environment;
never bake it into an image. The native SecretRef resolver supplies the string to
the plugin. `brokerUrl` preserves an optional path prefix, such as
`https://host.example/_clawscarf/connections`; query strings, fragments and URL
credentials are rejected. HTTPS is required except for loopback development endpoints. The
OpenShell deployment must explicitly permit the selected broker destination.

An empty plugin configuration exposes no executable tools and makes no broker
calls. Partial, unsafe or unresolved configuration fails when native tool factories
resolve it. Explicit native plugin disablement, role/tool policy and per-agent
restrictions remain authoritative. The three tools require SDK-supplied agent/call
identity; mutations and receipt lookup also require a native session. This is a
trusted-runtime context, not cryptographically verified per-human authorization.

The private [configuration helper](src/configuration.ts) adds a scoped environment
SecretRef and package path through OpenClaw's public mutation SDK. It preserves
unrelated edits, explicit disablement, allow/deny lists and per-agent overrides.
An explicit configure request may add the three tools to sandbox `alsoAllow` when
there is no explicit sandbox allow list. Observation uses the public snapshot API
with observation disabled, isolated environment resolution and `core-only` plugin
validation. This validates native core settings and checks the stored Connections
entry, SecretRef, provider, package path and enable policy without resolving plugin
metadata from SQLite. It preserves the source-file hash and requires no reader
sidecars, including on a read-only stopped home. Configuration mutations retain full
native validation. Stored configuration does not prove package loading or tool
readiness; the caller owns restart and native execution verification. See
[local activation](../../deploy/local/README.md#activate-connections).

## Build and verify

Use Node 24.16 or newer in the 24.x line, or Node 26.1 or newer. From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build
npm run test:native
npm run artifact
```

OpenClaw **2026.9.4** is the exact development and peer SDK candidate. The generated
client uses Hey API; after changing the contract, run `npm run api:generate` and
commit `generated/`. Generated transport code alone disables
`exactOptionalPropertyTypes` during compilation; plugin code/tests remain strict.
The artifact command writes the package and SHA-256 manifest to ignored
`.local/artifact/`. Runtime dependencies are bundled; OpenClaw is supplied by the
host runtime rather than copied into the package.

Unit/HTTP tests cover native identity, exact account/version arguments, cancellation,
credential exclusion, error semantics, slow responses, saved-result paging and
no mutation replay. The native package test uses temporary OpenClaw state and a
loopback test broker to exercise installation, restart and disablement. A native
configuration test verifies read-only observation, retained disablement, authored
allow/deny policy, path-prefixed broker URLs and rejected endpoints without writes
against the pinned mutation SDK. These tests
do not qualify OpenShell, live external account authentication, or model-driven
execution; those require distribution-level acceptance.

## Reuse and provenance

Source, skill, configuration helper and tests are extracted from RawClaw
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/plugins/connections).
The broker contract contains only its five runtime operations and reachable schemas
from that revision's [control-plane contract](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/openapi/control-plane.yaml). REST paths, account generations,
receipt semantics and native context are retained. Package/plugin identifiers and
the default credential environment variable use ClawScarf names.

The RawClaw full-manager SDK build/link scripts are replaced by this package's
local contract generation. Its Linux/systemd host-publisher tests are intentionally
not copied: they test root-owned VM paths and infrastructure outside this package.
Its portable native-package and tool/transport regressions are retained. The SDK
candidate is updated from the donor release and must be qualified on each target.
See [NOTICE](NOTICE) for attribution and [LICENSE](LICENSE) for distribution terms.
