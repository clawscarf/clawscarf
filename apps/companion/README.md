# Companion application

One process composes [Access](../../services/access/README.md) and optional
[Connections](../../services/connections/README.md). Access owns identity, admission,
login and revocation. Connections owns external accounts and its runtime protocol.
This application owns their configuration, database-pool lifetimes and maintenance;
neither service imports the other's implementation.

## Build and start

The [component manifest](../../release/components.json) pins the exercised Node
24.19.0 build/runtime image. From the repository root:

```sh
docker build \
  --build-arg NODE_IMAGE="$(node -p "require('./release/components.json').companionNode.image")" \
  -t clawscarf-companion:dev -f deploy/images/companion.Dockerfile .
```

This compiles both services and browser bundles into a production image with only
production dependencies. The local development tag is not a published release.
The recipe copies the root [license](../../LICENSE) and
[third-party notices](../../THIRD_PARTY_NOTICES.md) verbatim to
`/usr/share/licenses/clawscarf`, together with the incorporated
[shadcn notice](../../services/connections/web/shared/shadcn/LICENSE.md) as
`shadcn-MIT.txt`. A local rebuild verified these retained files against build inputs;
complete release license qualification remains open in the [remaining work](../../TODO.md).

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
Omitting Connections starts no provider, requires no Connections schema/catalog/key,
and exposes disabled capabilities without account actions. The native People page
contains no Connections navigation in this mode.

To enable Connections, add the optional block:

The [local assembly](../../deploy/local/README.md#optional-connections)
can generate this configuration and prepare its private catalog/database inputs.
For independently operated companions, supply the equivalent configuration below.

```json
{
  "accessConfigurationFile": "/run/clawscarf/access.json",
  "connections": {
    "projectId": "your-dedicated-project",
    "apiKeyFile": "/run/clawscarf/composio-key",
    "catalogDirectory": "/run/clawscarf/catalog"
  }
}
```

Run the separately owned migrations and catalog publication described in
[Connections setup](../../services/connections/README.md#configuration-and-catalog)
before enabling it. The same database stores both services in separate schemas;
each has a bounded connection pool. The shared private encryption key protects
purpose-bound data; upstream credentials remain outside native OpenClaw.
Enabled configuration must supply a nonempty key and a validated, published catalog
or startup fails. An invalid remote credential is reported when the provider is called;
startup does not connect a customer account.

The callback is derived from the Access public origin:
`/_clawscarf/connections/verify`. Management rechecks the current Access session and
acts through OpenClaw as that person. It never uses the bootstrap administrator as
a service credential. A configured Connections link appears in People only after
its existing native administrator check succeeds. Session refresh does not add a
Gateway RPC to discover navigation. Direct URLs still enforce current authority.

When Connections and management TLS are configured, `runtime.managementOrigin`
also exposes only `/_clawscarf/connections/v1/connector-runtime/` over that TLS
listener, using its actual Host. This lets the native plugin use the existing REST
broker with a scoped bearer credential and a trusted CA. Runtime authentication
rejects missing, revoked and mixed bearer/session credentials. This origin does
not expose account management, login, native HTTP or WebSocket paths. Connections
omitted means this route is absent. Native credential provisioning and
[activation](../../deploy/local/README.md#activate-connections) remain explicit
operator actions; enabling the broker does not configure the plugin.

The process runs the existing Connections maintenance sweep once at startup and
then once per minute without overlap. It processes persisted cleanup and retention
work, never provisioning. Shutdown cancels the sweep and closes both services and
pools. A failed sweep produces an allowlisted operator log and retains work for a
later sweep. Listen failures abort startup and close acquired resources.

## Verification

[The composed application test](../../tests/companion/composition.test.ts) uses real
PostgreSQL, HTTP ingress, management TLS, sessions and service factories, with injected native and
provider fixtures. It covers disabled operation without a Connections schema,
enabled account creation, CSRF rejection, native member denial, logout revocation
and invalid enabled configuration. The HTTPS broker checks cover active, missing,
invalid, mixed and revoked credentials, disabled routing and the management-path
boundary. Provider and native fixture results are not live
account or Gateway acceptance. Existing native access qualification is recorded in
[Access](../../services/access/README.md#reuse-and-verification).

The compiled image also started successfully with the production entry point and
Connections omitted. Its authenticated capabilities endpoint returned disabled,
its UI loaded without account actions, and its Access session contained no
Connections navigation. No fixture provider or provider credential was loaded.
The rebuilt image also passed expired-callback checks over HTTPS: browsers receive
the concise sign-in failure page, while API callers retain Problem Details. The
page rendered at desktop and mobile sizes.
