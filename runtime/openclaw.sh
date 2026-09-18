#!/bin/sh
set -eu
export HOME="/home/node"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
export SQLITE_TMPDIR="/tmp"
if [ -n "${CLAWSCARF_START_GATE:-}" ]; then
  /usr/local/bin/node /app/clawscarf/start-gate-main.js
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
