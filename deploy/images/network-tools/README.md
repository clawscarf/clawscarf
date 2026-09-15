# Native TCP dependency

[build.sh](build.sh) builds the unmodified Netfilter releases required by the
pinned OpenShell runtime on the pinned Debian 12 OpenClaw image. OpenShell's
[transparent TCP rules](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/crates/openshell-supervisor-process/src/netns/nft_ruleset.rs#L233)
use `output priority dstnat`. Debian 12's nftables 1.0.6 rejects that symbolic
priority in the output hook; 1.1.3 accepts it. The numeric equivalent works on the
same kernel, so this is a userspace compatibility requirement.

The official Debian 13 nftables package requires a newer libc through
libnftables1. Debian 12 has no current nftables backport. The build therefore uses
Debian 12's compiler and runtime libraries, without mixing Debian distributions,
patching OpenShell or changing its policy enforcement.

## Build output

Run the script only in a disposable image build stage based on the pinned
OpenClaw image; it installs build dependencies there and writes:

- `/out/runtime/usr/sbin/nft`: the runtime executable. OpenShell resolves trusted
  helpers from fixed system paths, so putting it only in `/usr/local` is insufficient.
- `/out/runtime/usr/share/licenses/clawscarf/network-tools/`: upstream COPYING files.
- `/out/sources/`: exact source archives for corresponding-source release artifacts.
- `/out/runtime-dependencies.txt`: build verification output, not application state.

Copy only `/out/runtime/` into the final runtime image. Explicit runtime packages
are `libmnl0=1.0.4-3`, `libgmp10=2:6.2.1+dfsg1-1.1` and
`libjansson4=2.14-2`, with the base image's Debian 12 libc. Do not install the older
Debian nftables executable over this payload. The build statically links
libnftnl and libnftables and rejects unexpected dynamic dependencies on either;
it does not replace global shared libraries. Native nft commands and JSON support
remain enabled. Interactive readline, man-page generation and optional xtables
compatibility are omitted; OpenShell uses none of those features.

## Source and redistribution

Exact official release inputs and SHA-256 values are enforced in the script:

| Component      | Source                                                                                      | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| nftables 1.1.3 | [Official archive](https://www.netfilter.org/projects/nftables/files/nftables-1.1.3.tar.xz) | `9c8a64b59c90b0825e540a9b8fcb9d2d942c636f81ba50199f068fde44f34ed8` |
| libnftnl 1.2.9 | [Official archive](https://www.netfilter.org/projects/libnftnl/files/libnftnl-1.2.9.tar.xz) | `e8c216255e129f26270639fee7775265665a31b11aa920253c3e5d5d62dfc4b8` |

Hashes fix the downloaded HTTPS bytes; signature verification is not claimed.
The archives include the original copyright and license notices. These Netfilter
components retain their GNU GPL terms; ClawScarf's MIT license does not replace
them. A published binary release must include the corresponding source archives
and this build script alongside its source distribution and retained notices.
Build inputs and compiler packages remain outside the application image.

Export the exact archives and build script from the same recipe for release:

```sh
docker build -f deploy/images/Dockerfile --target network-sources \
  --output type=local,dest=.local/release/network-tools-source .
```

A disposable Debian 12 build and a disposable Debian 13 official-package probe
both accepted the exact output-hook rule with nftables 1.1.3 on Docker Desktop
arm64. The resulting payload also passed disposable OpenShell startup with an explicit
TCP policy: the verifier accepted its acknowledged revision and exact endpoint,
and rejected a different port. No provider request was made. This establishes
loaded policy coverage, not endpoint reachability or isolation under attack.

Repeat the dependency probe against an exact built runtime image without applying
any rules (`--check` validates the candidate transaction):

```sh
docker run --rm -i --pull never --user root --cap-add NET_ADMIN \
  --entrypoint sh EXACT_RUNTIME_IMAGE -s < deploy/images/network-tools/check.sh
```

The capability belongs only to this disposable diagnostic container; it does not
change application process capabilities or an existing sandbox.
