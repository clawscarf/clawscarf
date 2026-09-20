#!/bin/sh
set -eu

# The candidate builder replaces this with the exact release being published.
version='@VERSION@'
prefix=${HOME:?}/.local
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      [ "$#" -ge 2 ] || { echo 'Missing --prefix directory.' >&2; exit 1; }
      prefix=$2; shift 2 ;;
    --help)
      echo 'Install ClawScarf, including its private Node runtime.'
      echo 'Usage: sh install.sh [--prefix DIRECTORY] (default: ~/.local)'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
case "$prefix" in /*) ;; *) echo '--prefix must be an absolute path.' >&2; exit 1 ;; esac
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64 ;;
  Linux-aarch64|Linux-arm64) platform=linux-arm64 ;;
  Linux-x86_64) platform=linux-x64 ;;
  *) echo 'Use macOS Apple Silicon or Linux ARM64/x86-64. On Windows, run inside WSL2.' >&2; exit 1 ;;
esac
for tool in curl tar; do
  command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
if command -v sha256sum >/dev/null; then
  checksum=sha256sum
elif command -v shasum >/dev/null; then
  checksum='shasum -a 256'
else
  echo 'Install sha256sum or shasum to verify the download.' >&2; exit 1
fi
destination=$prefix/lib/clawscarf/$version
command=$prefix/bin/clawscarf
if [ -e "$command" ] || [ -L "$command" ]; then
  case "$(readlink "$command" || true)" in
    "$prefix"/lib/clawscarf/*/clawscarf) ;;
    *) echo "$command already exists. Choose another --prefix or remove that command first." >&2; exit 1 ;;
  esac
fi
if [ -e "$destination" ]; then
  echo "ClawScarf $version is already installed in $destination." >&2
  exit 1
fi
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
asset=clawscarf-$version-$platform.tgz
base=https://github.com/clawscarf/clawscarf/releases/download/v$version
echo "Downloading ClawScarf $version for $platform (includes Node.js)…"
curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 --max-time 600 "$base/$asset" -o "$temporary/$asset"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 --max-time 60 "$base/SHA256SUMS" -o "$temporary/SHA256SUMS"
awk -v asset="$asset" '$2 == asset { print }' "$temporary/SHA256SUMS" > "$temporary/selected.sha256"
[ "$(wc -l < "$temporary/selected.sha256" | tr -d ' ')" = 1 ] || { echo 'Release checksum is missing or ambiguous.' >&2; exit 1; }
(cd "$temporary" && $checksum -c selected.sha256)
tar -xzf "$temporary/$asset" -C "$temporary"
"$temporary/clawscarf/clawscarf" --help >/dev/null
mkdir -p "$prefix/lib/clawscarf" "$prefix/bin"
mv "$temporary/clawscarf" "$destination"
ln -sfn "$destination/clawscarf" "$command"
echo "Installed ClawScarf $version."
case ":$PATH:" in
  *":$prefix/bin:"*) echo 'Run: clawscarf configure' ;;
  *)
    echo "Add $prefix/bin to PATH in your shell profile."
    printf 'For now, run: "%s" configure\n' "$command" ;;
esac
