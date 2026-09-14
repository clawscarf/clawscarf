#!/bin/sh
set -eu
export HOME="/home/node"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
export SQLITE_TMPDIR="/tmp"
export CLAWSCARF_PACK_RUNTIME=1
if [ -z "${NODE_EXTRA_CA_CERTS+x}" ] && [ -r "$OPENCLAW_STATE_DIR/clawscarf-models/ca.pem" ]; then
  export NODE_EXTRA_CA_CERTS="$OPENCLAW_STATE_DIR/clawscarf-models/ca.pem"
fi
exec /usr/local/bin/node /app/clawscarf/pack-tools/scripts/packs.js --openclaw /app/clawscarf/bin/openclaw "$@"
