#!/bin/sh
# Build only inside the pinned Debian 12 image build stage.
set -eu

apt-get update
apt-get install -y --no-install-recommends \
  build-essential=12.9 pkg-config=1.8.1-1 bison=2:3.8.2+dfsg-1+b1 flex=2.6.4-8.2 \
  libmnl-dev=1.0.4-3 libgmp-dev=2:6.2.1+dfsg1-1.1 libjansson-dev=2.14-2 \
  curl=7.88.1-10+deb12u15 ca-certificates=20250419~deb12u1 xz-utils=5.4.1-1+deb12u1
rm -rf /var/lib/apt/lists/*

mkdir -p /build/netfilter /opt/netfilter /out/runtime/usr/sbin \
  /out/runtime/usr/share/licenses/clawscarf/network-tools /out/sources
cd /build/netfilter
curl --fail --show-error --silent --location \
  https://www.netfilter.org/projects/libnftnl/files/libnftnl-1.2.9.tar.xz \
  --output libnftnl-1.2.9.tar.xz
curl --fail --show-error --silent --location \
  https://www.netfilter.org/projects/nftables/files/nftables-1.1.3.tar.xz \
  --output nftables-1.1.3.tar.xz
cat <<'CHECKSUMS' | sha256sum --check --strict
e8c216255e129f26270639fee7775265665a31b11aa920253c3e5d5d62dfc4b8  libnftnl-1.2.9.tar.xz
9c8a64b59c90b0825e540a9b8fcb9d2d942c636f81ba50199f068fde44f34ed8  nftables-1.1.3.tar.xz
CHECKSUMS
cp libnftnl-1.2.9.tar.xz nftables-1.1.3.tar.xz /out/sources/
tar -xJf libnftnl-1.2.9.tar.xz
tar -xJf nftables-1.1.3.tar.xz

cd libnftnl-1.2.9
./configure --prefix=/opt/netfilter --disable-shared --enable-static
make -j2
make install
install -m 0644 COPYING /out/runtime/usr/share/licenses/clawscarf/network-tools/libnftnl-COPYING
cd ../nftables-1.1.3
PKG_CONFIG_PATH=/opt/netfilter/lib/pkgconfig LDFLAGS=-L/opt/netfilter/lib \
  ./configure --prefix=/usr/local --disable-shared --enable-static \
    --disable-man-doc --with-cli=no --with-json --without-xtables
make -j2
install -m 0755 src/nft /out/runtime/usr/sbin/nft
strip /out/runtime/usr/sbin/nft
install -m 0644 COPYING /out/runtime/usr/share/licenses/clawscarf/network-tools/nftables-COPYING

/out/runtime/usr/sbin/nft --version | grep -F 'nftables v1.1.3 '
ldd /out/runtime/usr/sbin/nft > /out/runtime-dependencies.txt
if grep -E 'libnftables|libnftnl|not found' /out/runtime-dependencies.txt; then
  echo 'Unexpected shared Netfilter dependency in runtime payload.' >&2
  exit 1
fi
