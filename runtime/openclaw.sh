#!/bin/sh
set -eu
export HOME="/home/node"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
export SQLITE_TMPDIR="/tmp"
if [ -r "$OPENCLAW_STATE_DIR/clawscarf-models/ca.pem" ]; then
  NODE_EXTRA_CA_CERTS="$(/usr/local/bin/node /app/clawscarf/trust-main.js)"
  export NODE_EXTRA_CA_CERTS
fi
exec /usr/local/bin/node /app/openclaw.mjs "$@"
