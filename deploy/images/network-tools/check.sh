#!/bin/sh
# Run on stdin in a disposable runtime container with CAP_NET_ADMIN.
set -eu
/usr/sbin/nft --version | grep -F 'nftables v1.1.3 '
/usr/sbin/nft --check --file - <<'RULESET'
table inet clawscarf_dependency_probe {
  chain output {
    type nat hook output priority dstnat; policy accept;
  }
}
RULESET
