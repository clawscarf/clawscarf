# Model gateways

OpenClaw uses its native OpenAI-compatible provider support. Choose an existing
LiteLLM with a scoped runtime key, or the bundled LiteLLM companion.
Provider-key and existing-gateway configurations need no Cloud billing integration.
Cloud AI uses the same bundled LiteLLM with a scoped Cloud inference credential;
provider credentials remain in Cloud.
Configuration is operator tooling; people use OpenClaw's model settings afterward.

## Configuration and credentials

Use `clawscarf configure --directory /path/to/team` for initial setup and later
changes. The [installation guide](../deployment/installation.md#models) lists the
model, provider, reasoning and credential options. Bundled LiteLLM owns its private
TLS listener, database and scoped runtime key. An existing LiteLLM gateway uses
its operator-provided endpoint, runtime key and optional CA.

[configuration.ts](../../scripts/models/configuration.ts) maps selected routes to
LiteLLM and native OpenClaw settings. The [runtime helper](../../runtime/models.ts)
validates those settings before applying them to the stopped, owned home volume.
It preserves unrelated providers, fallback settings and per-agent overrides. Existing
conversations may retain their model selection. Provider secrets and LiteLLM's master
key stay outside OpenClaw; the runtime receives only a scoped `llm_api` key through
a private file SecretRef. Public CA trust is combined with OpenShell's inherited CA.

The helper returns structured rejection or uncertain outcomes. No uncertain write
is automatically replayed. Interrupted settings changes keep the server stopped
until explicitly resumed through `configure`.

[compose.yaml](compose.yaml) pins LiteLLM and exposes its API only on loopback.
[compose.tls.yaml](compose.tls.yaml) adds private TLS for the protected runtime.
LiteLLM owns its separate database and migrations. Its management API must not be
publicly exposed. Key administration, including revocation, uses LiteLLM's own API.
Normal configuration updates only the existing key's model permissions; it never
renews, unblocks or replaces that key.

## Verification and provenance

Adapted from RawClaw [gateway rendering](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/scripts/render-ai-gateway.ts),
[native provider mapping](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/runtime/openclaw/ai-config.mjs)
and [image pin](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/deploy/ai-gateway/Dockerfile).
Hosted admission, accounting, model inheritance and source-IP checks are omitted;
LiteLLM's own virtual-key authorization replaces that deployment-specific hook.
See upstream [virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys) and
[native LiteLLM provider](https://docs.openclaw.ai/providers/litellm).

[Credential tests](../../tests/models/credentials.test.ts) exercise issuance against a local HTTPS server: missing CA trust fails before
a request and explicit trust succeeds.
[Runtime failure tests](../../tests/models/runtime-errors.test.ts) cover strict
input validation, definite dry-run failure, missing executables, uncertain applies,
credential retention and structured failure transport without replay.

[Gateway tests](../../tests/models/gateway.test.ts) exercise LiteLLM with real
Postgres and a controlled upstream: discovery, text/tool responses, streaming,
errors without replay, model/management denial and revocation. The
[OpenShell probe](../../tests/models/openshell-probe.mjs) exercises native inference
and tool execution over the configured TLS route. Provider/model availability is
not implied by a selectable catalog entry; selected-release evidence belongs to
[release acceptance](../../release/README.md#release-evidence).

Custom Responses routes enable `supportsStrictMode` so optional tool arguments can
use `strict: false`. The runtime [capability probe](../../tests/runtime/capabilities.mjs)
checks the actual request builder before HTTP. Protocol selection belongs to the
[model catalog](#installer-choices), not a separate provider bypass.

For isolated gateway tests, render [gateway.fixture.json](../../tests/models/gateway.fixture.json)
as its generated route configuration, set `TEST_PROVIDER_KEY=test-provider` in its private environment,
and use a dedicated test database/master key. Start it with the Compose file on
port 14000; the test hosts its controlled upstream on port 14001.

```sh
CLAWSCARF_TEST_LITELLM=1 CLAWSCARF_TEST_LITELLM_MASTER_KEY_FILE=/private/test-master-key pnpm exec tsx --test tests/models/gateway.test.ts
```

Never run that fixture against a production gateway or database.

The [Cloud gateway regression](../../tests/models/cloud-gateway.test.ts) separately
checks Cloud model IDs through the pinned LiteLLM image for both Chat Completions
and Responses, JSON and streaming, successful requests and HTTP 402 failures with
no replay. It uses a controlled upstream on port 14501, no paid provider account.
Set `CLAWSCARF_TEST_CLOUD_GATEWAY=1`, `CLAWSCARF_TEST_MODEL_CONFIGURATION` to the
isolated rendered model input, and `CLAWSCARF_TEST_LITELLM_MASTER_KEY_FILE` to that
gateway's private test key. Its route must use `openai/cloud-fixture`, public
model ID `cloud-fixture`, and upstream key `scoped-test-cloud-secret`.
LiteLLM preserves the HTTP status and readable message but rewrites the public
error code to `402`; native Account reads the authoritative Cloud allowance state.

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
`controlled native tool result`. Use `clawscarf configure` with the private fixture catalog, gateway URL,
scoped runtime key and public CA. The
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
documented in the [installation guide](../deployment/installation.md#terminal-installer).
Component operators may still use disabled-model fixtures for isolated tests; those
are not supported product installation modes.

## Installer choices

[The model catalog](catalog.json) ships with the CLI and supplies model/provider choices
for setup. Recipes select defaults from it; runtime releases contain no model settings.
Operators can import their own catalog through the advanced menu or `--model-catalog`.
Each model can select the native `api` protocol (`openai-completions` or
`openai-responses`) used between OpenClaw and LiteLLM. Direct OpenAI offerings use
Responses so tool calls and reasoning work together; other offerings use Chat
Completions unless specified. LiteLLM owns upstream translation.
Catalog order controls model/provider menu order, with direct providers first and
OpenRouter last. [Recipes](../../recipes/README.md) select defaults from those offerings.
Model limits are explicit data, not
a discovery call made during installation. The current catalog conservatively enables
text input; it does not claim tested image handling or every upstream model capability.

The separate [Cloud catalog snapshot](cloud-catalog.json) supplies initial hosted
model choices. Its model capabilities were checked against OpenRouter on 2026-09-23;
the installer validates availability against the authenticated live API before
enablement. Its prices are indicative snapshot data, not installer promises.
Every hosted route uses the selected Cloud origin's `/v1` endpoint through LiteLLM;
Cloud model IDs cannot select another destination. Catalog selection and account
enablement have no Cloud default model: the installation sends its chosen model.

Provider route prefixes use LiteLLM's documented
[OpenAI](https://docs.litellm.ai/docs/providers/openai),
[Anthropic](https://docs.litellm.ai/docs/providers/anthropic),
[Google](https://docs.litellm.ai/docs/providers/gemini) and
[OpenRouter](https://docs.litellm.ai/docs/providers/openrouter) adapters. These are selectable
configuration routes, not a claim that each account/model combination has passed live
inference. The installer asks for keys only after reviewing the selected settings.

The installation [settings editor](../deployment/installation.md#change-an-existing-installation)
can update routes, defaults and provider keys. Changing enabled models updates only
the existing runtime key’s model permissions through LiteLLM; it does not regenerate
the key, unblock it or extend its expiry. Explicit recovery first observes matching
permissions and native managed fields instead of repeating a confirmed mutation.

Cloud and provider-key offerings share canonical model IDs (for example,
`gpt-6-astra` or `claude-fable-5-1`). Native selection is `clawscarf/<model>`;
LiteLLM and Cloud own the upstream route names. The public Cloud model contract
includes accepted reasoning efforts and temperature support. These are carried
into native `compat` metadata, including for internal calls such as permission
reviewers that do not inherit the conversation's reasoning setting. Omitting
`none` preserves the provider default for mandatory-reasoning models; it does not
choose a different reviewer model or change permissions.
