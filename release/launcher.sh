#!/bin/sh
set -eu

# Resolve the public command's symlink without depending on GNU readlink -f.
script=$0
while [ -L "$script" ]; do
  directory=$(CDPATH= cd -- "$(dirname -- "$script")" && pwd)
  script=$(readlink "$script")
  case "$script" in /*) ;; *) script=$directory/$script ;; esac
done
directory=$(CDPATH= cd -- "$(dirname -- "$script")" && pwd)
exec "$directory/node/bin/node" "$directory/package/scripts/clawscarf.js" "$@"
