#!/bin/sh
set -eu
export HOME="/home/node"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
export SQLITE_TMPDIR="/tmp"
export OPENCLAW_NO_SELF_UPDATE=1
export OPENCLAW_NO_GITHUB=1
# OpenShell owns target resolution and destination enforcement. Native web tools
# must use its proxy rather than attempting local DNS inside the sandbox.
if [ -n "${HTTPS_PROXY:-}" ]; then
  OPENCLAW_PROXY_URL="$HTTPS_PROXY"
  export OPENCLAW_PROXY_URL
  export NODE_USE_ENV_PROXY=1
fi
if [ -z "${OPENCLAW_GATEWAY_PASSWORD:-}" ]; then
  OPENCLAW_GATEWAY_PASSWORD="$(/usr/local/bin/node /app/clawscarf/gateway-password-main.js "${1:-}" "${2:-}")"
  export OPENCLAW_GATEWAY_PASSWORD
fi
connections_token="$(/usr/local/bin/node /app/clawscarf/connections-credential-main.js)"
if [ -n "$connections_token" ]; then
  CLAWSCARF_CONNECTIONS_TOKEN="$connections_token"
  export CLAWSCARF_CONNECTIONS_TOKEN
fi
unset connections_token
runtime_trust="$(/usr/local/bin/node /app/clawscarf/trust-main.js)"
if [ -n "$runtime_trust" ]; then
  NODE_EXTRA_CA_CERTS="$runtime_trust"
  export NODE_EXTRA_CA_CERTS
fi
unset runtime_trust
if [ "${1:-}" = "gateway" ]; then
  mkdir -p "$OPENCLAW_STATE_DIR/workspace"
  cd "$OPENCLAW_STATE_DIR/workspace"
fi
exec /usr/local/bin/node /app/openclaw.mjs "$@"
