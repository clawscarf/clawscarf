# Model gateways

OpenClaw uses its native OpenAI-compatible provider support. Choose an existing
LiteLLM with a scoped runtime key, or the bundled LiteLLM companion.
No external hosting control plane or billing hook is required.
Configuration is operator tooling; people use OpenClaw's model settings afterward.

For a new local installation, [initial model setup](../local/README.md#initial-model-setup)
combines this configuration, a scoped runtime key and its network permission before
first startup. Existing installations use the explicit configuration commands below.
Fresh setup and explicit configuration share the model/default mapping, including
an optional `thinkingDefault`. Omitted thinking settings preserve native defaults.

For bundled models in a new complete installation, use the
[unified LiteLLM selection](../local/installation.md#models). It owns the private
TLS listener, separate model database, initial scoped key and start/stop lifecycle.
The component commands below remain available for explicit model operations; their
full configuration includes the endpoint, unlike the unified route-only input.

## Configure OpenClaw

Copy [config.example.json](config.example.json) to private deployment configuration.
Set `mode` to `external` for an existing gateway or `litellm` for the companion.
Describe the actual offered models and capabilities; the example is illustrative,
not a supported-model catalog. `route` belongs only to LiteLLM: its model identifier
uses LiteLLM's provider prefix and its key is an environment-variable name.
Disabled models are excluded. A null `defaultModel` preserves the current default.

For the OpenShell deployment, run the host command from this checkout with its
Node/pnpm dependencies. Select the controller's isolated XDG configuration as in
[controller setup](../openshell/README.md#contributor-controller-setup). The runtime
image contains the compiled [configuration helper](../../runtime/models.ts) and its
pinned Zod validation dependency;
it does not need this checkout or pnpm. Supply a scoped runtime key, never a
LiteLLM master or upstream-provider key:

```sh
pnpm clawscarf models configure-runtime --config /private/models.json --openshell /absolute/path/to/openshell --gateway clawscarf --sandbox team --key-file /private/runtime-key --ca-file /private/gateway-ca.pem
pnpm clawscarf models configure-runtime --config /private/models.json --openshell /absolute/path/to/openshell --gateway clawscarf --sandbox team --key-file /private/runtime-key --ca-file /private/gateway-ca.pem --yes
```

Omit `--ca-file` for a gateway with a publicly trusted certificate. The controller
transports the scoped key through authenticated exec stdin; it is never a command
argument. The helper writes a private credential generation in persistent runtime
state and configures a native file SecretRef. The public CA is stored separately for the canonical launcher. Gateway restarts
and operator commands use the same file-backed credential without token environment
injection. The launcher combines this CA with any inherited `NODE_EXTRA_CA_CERTS`
bundle, including OpenShell's proxy CA, and supplies the combined file to Node.
Public bundles are stored by content digest under `clawscarf-models/trust`; repeated
startup reuses the same bundle, and changed certificates produce a new one.
Unreadable inherited trust or a mismatched existing bundle stops startup.
This extends trust for the Node process, not only this provider, and preserves
certificate verification. A new or changed
CA requires an explicit Gateway restart. Applying without `--ca-file` removes this
configured CA file; operator-provided environment trust remains untouched.

For an already installed native CLI on the machine running the host tooling,
`configure --config /private/models.json --openclaw openclaw [--yes]` is also
available. That mode uses `CLAWSCARF_MODEL_TOKEN` in both the CLI and Gateway process;
it is not the OpenShell deployment command.

The first command validates without writing. The second uses one native OpenClaw
2026.9.4 config batch to replace the `clawscarf` provider and its credential
reference, and optionally select the default model. It preserves other providers,
fallbacks, per-agent overrides and unrelated configuration. Existing sessions may
retain their selected model; this command does not rewrite conversations. Native
config validation/reload owns runtime activation. Check the effective model in
OpenClaw before using it. Repeating the confirmed command deliberately reapplies
those same selected settings; there is no background configuration controller.
The runtime helper validates a strict request and returns structured outcomes.
Running OpenShell and stopped-volume commands share the same bounded subprocess
protocol; only their invocation differs.
Invalid input/state, unavailable execution and rejected validation are distinct
from an uncertain apply. Lost or malformed execution responses remain uncertain
after dispatch; the controller never retries a mutation automatically.
Dry-run leaves native configuration unchanged and removes its temporary credential.
A confirmed or uncertain apply retains its private credential generation; previous
generations are retained because a live Gateway may still be using them while it
reloads. After effective native verification, revoke the old key explicitly through
LiteLLM. Credential-file cleanup is an operator task; it is not inferred from CLI
success.

`{"mode":"disabled"}` makes the tool perform no calls or writes. It does not delete
user configuration or revoke an already-issued key. Revoke the key explicitly when
retiring gateway access, then select another model in OpenClaw.

## Bundled LiteLLM

[compose.yaml](compose.yaml) pins the donor's LiteLLM image. It exposes only a
loopback port. A container/OpenShell runtime needs an explicitly authorized private
network route to that endpoint; container loopback is not host loopback. Public
TLS ingress and OpenShell policy are deployment concerns, not implicit changes made
by the model command. Do not expose the management API publicly.

Create a private configuration directory and a dedicated LiteLLM database on your
Postgres server. LiteLLM owns its schema and migrations; do not share its database
with Access/Connections tables. Copy [gateway.env.example](gateway.env.example)
to that directory as `gateway.env`, mode 0600, and replace every example value.
`LITELLM_MASTER_KEY` is the administrator key; `LITELLM_SALT_KEY` is stable encryption
material. Both and upstream provider credentials stay in this companion only.

```sh
pnpm clawscarf models render --config /private/models.json --output /private/gateway/models.json
CLAWSCARF_MODELS_DIRECTORY=/private/gateway docker compose -f deploy/models/compose.yaml up -d
```

The renderer writes JSON (accepted as YAML by LiteLLM), includes enabled routes and
secret environment references, and refuses to overwrite existing output. Change
routes by rendering reviewed replacement configuration and restarting the companion.
No automatic gateway request retries or provider fallback are configured; native OpenClaw retains its own retry policy.

Use LiteLLM's built-in key management to issue a runtime key limited to the enabled
model IDs. Put the administrator key alone in a separate private file for the CLI:

```sh
pnpm clawscarf models issue-key --config /private/models.json --origin http://127.0.0.1:14000 --master-key-file /private/master-key --output /private/runtime-key
pnpm clawscarf models revoke-key --origin http://127.0.0.1:14000 --master-key-file /private/master-key --key-file /private/runtime-key --yes
```

Both credential commands accept `--ca-file /private/management-ca.pem` for a
private HTTPS management endpoint. The option adds explicit CA trust for that
command; certificate and hostname verification remain enabled. Omit it for
publicly trusted HTTPS or the loopback HTTP component example above.

Issued keys have LiteLLM's `llm_api` type: inference only, with no administration
access. The output file is created mode 0600 without overwrite; secrets never print.
For rotation, issue a new key, replace the runtime secret, then revoke the old key.
A lost issuance response is uncertain: inspect/revoke the orphan in LiteLLM's
operator interface before repeating. No mutation is automatically replayed.
This is one trusted team's gateway, not a per-person spending or billing system.

## Verification and provenance

Adapted from RawClaw [gateway rendering](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/scripts/render-ai-gateway.ts),
[native provider mapping](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/runtime/openclaw/ai-config.mjs)
and [image pin](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/deploy/ai-gateway/Dockerfile).
Hosted admission, accounting, model inheritance and source-IP checks are omitted;
LiteLLM's own virtual-key authorization replaces that deployment-specific hook.
See upstream [virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys) and
[native LiteLLM provider](https://docs.openclaw.ai/providers/litellm).

[Credential CLI tests](../../tests/models/credentials.test.ts) exercise issuance and
revocation against a local HTTPS server: missing CA trust fails before either
request, explicit trust succeeds, and scoped credentials do not print.
[Runtime failure tests](../../tests/models/runtime-errors.test.ts) cover strict
input validation, definite dry-run failure, missing executables, uncertain applies,
credential retention and structured failure transport without replay.

[Native tests](../../tests/models/native.test.ts) passed against OpenClaw 2026.9.4:
validation without writes, atomic application, customer provider/default fallback
and agent override preservation, and disabled configuration.
[Gateway tests](../../tests/models/gateway.test.ts) passed against the pinned
LiteLLM image and real Postgres, with a controlled upstream: discovery, text and
tool responses, streaming, upstream failure without replay, model/management denial
and revocation. A separate OpenShell proof passed native OpenClaw model streaming and a successful
native read tool through this gateway over private TLS. It also verified CA trust
failure, unauthenticated denial, model/management denial and credential revocation.
An additional actual-model run used Qwen3 1.7B through LiteLLM's standard Ollama
provider: native inference and a read tool completed without execution errors.
The small model misquoted the file and made an invalid read invocation on a repeat
run. This qualifies the successful transport/tool execution, not repeatable model
quality or a production model recommendation. These isolated controlled/Ollama
tests required no paid provider credentials.

The fresh local assembly passed integrated initial model/credential/policy setup
and a native administrator browser conversation through the rebuilt runtime,
private-TLS LiteLLM and OpenRouter GPT-5.4 Mini. Native
transcript records confirm `clawscarf/team-model`, successful read-tool execution
and the exact synthetic file contents in the final response. Both the inherited
OpenShell CA and private gateway CA remained active. The scoped runtime key was
then revoked; the gateway rejected it with HTTP 401. This was an isolated acceptance
installation, not a production model default. The actual browser path is qualified
for that administrator configuration; member execution and release-artifact
clean-machine acceptance remain separate.

```sh
CLAWSCARF_TEST_NATIVE_MODELS=1 pnpm exec tsx --test tests/models/native.test.ts
```

For isolated gateway tests, render [gateway.fixture.json](../../tests/models/gateway.fixture.json)
as its generated route configuration, set `TEST_PROVIDER_KEY=test-provider` in its private environment,
and use a dedicated test database/master key. Start it with the Compose file on
port 14000; the test hosts its controlled upstream on port 14001.

```sh
CLAWSCARF_TEST_LITELLM=1 CLAWSCARF_TEST_LITELLM_MASTER_KEY_FILE=/private/test-master-key pnpm exec tsx --test tests/models/gateway.test.ts
```

Never run that fixture against a production gateway or database.

### Private TLS and OpenShell proof

[compose.tls.yaml](compose.tls.yaml) adds LiteLLM's own TLS listener. Supply
`server.key` and `server.crt` in the private gateway directory; the runtime receives
only the public CA certificate and its scoped runtime key. Add both Compose files
with `-f`, and set `CLAWSCARF_MODELS_PORT` to the intended private port. Gateway
URLs outside loopback require HTTPS. This does not open public ingress.

The [isolated proof policy](../../tests/models/openshell-policy.yaml) authorizes
only Node to `host.docker.internal:14400` through OpenShell's existing proxy.
`tls: skip` tells that proxy to tunnel TLS without interception; the Node client
still verifies the companion certificate using its private CA. It does not disable
TLS verification. The default runtime policy remains deny-all. Do not apply the
proof endpoint to an unrelated deployment.

For reproduction, use the gateway fixture with `baseUrl` changed to
`https://host.docker.internal:14400/v1`, a certificate for that hostname, the TLS
Compose overlay and the isolated test database. Run
[the controlled upstream](../../tests/models/native-upstream.mjs) on host port 14001.
In a disposable OpenShell runtime, initialize normal native configuration with the
read tool enabled and a workspace file named model-proof.txt containing
`controlled native tool result`. Use `configure-runtime` above with the private
fixture configuration, scoped runtime key and public CA. The
[probe](../../tests/models/openshell-probe.mjs) invokes the shipped canonical
launcher without injecting a model token or replacing inherited CA trust: the key comes from its
native file SecretRef and the launcher combines the configured public CA with
the inherited controller trust. The probe preserves that inherited trust variable.

```sh
openshell sandbox exec --name YOUR_PROOF_SANDBOX -- node --input-type=module < tests/models/openshell-probe.mjs
```

The probe checks actual native provider/model selection and successful tool
execution, not a fabricated assistant response alone. These files and keys are
for an isolated proof only; revoke the runtime key and remove its sandbox afterward.

For an already configured actual model, set the non-secret
`CLAWSCARF_TEST_REAL_MODEL=1` on the probe's OpenShell exec command to allow its
longer inference deadline. Configure the external gateway using its supported
provider options; the tested local Qwen route used LiteLLM's standard
`reasoning_effort: none` to disable reasoning. The probe checks completion and
native tool execution, not model answer accuracy.

The unified installer requires bundled or existing LiteLLM. Its recipe/review flow is
documented in the [installation guide](../local/installation.md#terminal-installer).
Component operators may still use disabled-model fixtures for isolated tests; those
are not supported product installation modes.

## Installer choices

[The release catalog](catalog.json) contains model/provider choices for initial setup.
Release creation embeds it by default; a release input can supply its own `modelCatalog`.
Catalog order controls model/provider menu order, with direct providers first and
OpenRouter last. Recipes choose defaults from those offerings; Team documents selects
direct OpenAI GPT-6 Astra with medium reasoning. Model limits are explicit data, not
a discovery call made during installation. The current catalog conservatively enables
text input; it does not claim tested image handling or every upstream model capability.

Provider route prefixes use LiteLLM's documented
[OpenAI](https://docs.litellm.ai/docs/providers/openai),
[Anthropic](https://docs.litellm.ai/docs/providers/anthropic),
[Google](https://docs.litellm.ai/docs/providers/gemini) and
[OpenRouter](https://docs.litellm.ai/docs/providers/openrouter) adapters. These are selectable
configuration routes, not a claim that each account/model combination has passed live
inference. The installer asks for keys only after reviewing the selected settings.

The installation [settings editor](../local/installation.md#change-an-existing-installation)
can update routes, defaults and provider keys. Changing enabled models updates only
the existing runtime key’s model permissions through LiteLLM; it does not regenerate
the key, unblock it or extend its expiry. Explicit recovery first observes matching
permissions and native managed fields instead of repeating a confirmed mutation.
