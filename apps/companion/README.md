# Companion application

One process composes [Access](../../services/access/README.md) and optional
[Connections](../../services/connections/README.md). Access owns identity, admission,
login and revocation. The optional Connections adapter forwards authorized management requests to the cloud.
Access owns its database pool; broker storage and maintenance run in the cloud.

## Build and start

The [component manifest](../../release/components.json) pins the build/runtime image.
From the repository root:

```sh
docker build \
  --build-arg NODE_IMAGE="$(node -p "require('./release/components.json').companionNode.image")" \
  -t clawscarf-companion:dev -f deploy/images/companion.Dockerfile .
```

This compiles Access and the management adapter into a production image with only
production dependencies. The local development tag is not a published release.
The recipe copies the root [license](../../LICENSE) and
[third-party notices](../../THIRD_PARTY_NOTICES.md) verbatim to
`/usr/share/licenses/clawscarf`. Native page assets are built into the OpenClaw
plugins, not this backend image. Complete release license qualification remains
open in the [remaining work](../../TODO.md).

Set `CLAWSCARF_COMPANION_CONFIG` to a private configuration file, then run
`pnpm companion:start`. The [Compose fragment](../../deploy/compose/companion.yaml)
uses the compiled [application image](../../deploy/images/companion.Dockerfile).
Its default mount contains `/run/clawscarf/companion.json`:

```json
{
  "accessConfigurationFile": "/run/clawscarf/access.json"
}
```

After preparing the Access configuration, database and private management TLS
files, the composition with Connections disabled can be started with:

```sh
CLAWSCARF_COMPANION_IMAGE=clawscarf-companion:dev \
CLAWSCARF_COMPANION_CONFIG_DIRECTORY=/absolute/path/to/private/config \
CLAWSCARF_COMPANION_UID="$(id -u)" CLAWSCARF_COMPANION_GID="$(id -g)" \
docker compose -f deploy/compose/companion.yaml up -d
```

The referenced file follows the [Access configuration](../../services/access/README.md#configuration-and-operation).
Omitting Connections requires no broker key, schema or catalog and mounts no account
management routes. Its optional native plugin is enabled separately by installation
configuration; account pages render inside OpenClaw.

For the cloud broker, configure the management adapter instead:

```json
{
  "accessConfigurationFile": "/run/clawscarf/access.json",
  "cloudConnections": {
    "url": "https://cloud.example.com",
    "managementKeyFile": "/run/clawscarf/connections-management-key"
  }
}
```

This mode needs no local Connections schema, catalog, provider key or maintenance
loop. The native plugin's runtime URL is that origin plus `/api/connections`, with
its separate runtime credential. Both credentials are scoped to one cloud installation.
The installer generates this adapter configuration when hosted Connections is enabled.

## Verification

[Process lifecycle tests](../../tests/companion/process-lifecycle.test.ts) cover
listener failures and cleanup. [Access](../../services/access/README.md#reuse-and-verification)
and [Connections](../../services/connections/README.md) own service-level tests;
broker/provider tests belong to the cloud service.
Installation acceptance uses the [release evidence contract](../../release/README.md#release-evidence).
