# Browser network

The [browser](../browser/README.md) runs on a Docker internal bridge with
`com.docker.network.bridge.gateway_mode_ipv4=isolated`. It has no default route
or host port publication. Two maintained proxies provide separate paths:

- HAProxy forwards native TCP to the fixed browser upstream. The browser retains
  CDP token authentication. The relay has no admin listener, credentials or generic
  forward-proxy capability. It does not parse or translate native protocols.
- [Squid](squid.conf) accepts only the browser's exact source address and permits
  public HTTP on port 80 and HTTPS CONNECT on port 443. Destination ACLs require
  successful resolution and reject nonpublic addresses, including private,
  loopback, link-local, metadata, multicast and reserved ranges. TLS is end-to-end;
  Squid does not decrypt it. Access logging and cache storage are disabled.

This is public-web containment, not a domain allowlist or a content filter.
Public sites can receive uploaded team data. Administrators who control Docker
or these root-owned network settings can change the boundary. Native plugins
execute with Gateway authority and are outside the browser boundary.

## Composition contract

The composition owns a nonoverlapping private IPv4 subnet, static browser address,
private profile/token volumes and lifecycle. Required service wiring:

| Service       | Networks                                                              | Listener          | Runtime configuration                                                                                |
| ------------- | --------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Browser       | Isolated browser network only; alias `browser`                        | 9223              | `CLAWSCARF_BROWSER_PROXY_SERVER=http://browser-egress:3128`; existing browser token/profile settings |
| Egress        | Isolated browser network plus outbound bridge; alias `browser-egress` | 3128, unpublished | Read-only `/etc/squid/browser-source.acl`, containing the browser's exact IPv4 `/32`                 |
| Runtime relay | Owned runtime network; also isolated browser network when enabled     | 9223 for CDP      | Read-only generated `/usr/local/etc/haproxy/haproxy.cfg`; alias `runtime.clawscarf.internal`         |

The relay has one upstream, `browser:9223`; CDP is published on operator loopback
for readiness. No relay service is needed when the browser is disabled. The relay
never joins the companion network and has no worker/SSH listener.

The generated configuration uses native Docker DNS resolution (`127.0.0.11:53`)
with `resolvers` and `init-addr libc,none` for the browser backend, allowing the
browser container to start later or change address. Fixed listeners do not accept
a destination from clients. CDP byte streams pass through unchanged.
OpenShell policies target the ordinary relay DNS name and exact listener port;
policy DNS supplies synthetic addresses and enforces the native caller binary.
Reserved Docker host aliases are not used as native client targets.

The browser must not attach to another network. IPv6 is disabled on the
browser network; the Squid IPv6 ACL also filters destinations resolved by the
proxy.

Both proxy containers run nonroot, read-only, with all capabilities dropped,
`no-new-privileges` and a private writable `/tmp` tmpfs. Set bounded CPU, memory
and process limits. HAProxy runs on high ports with zero effective capabilities.
Squid requires no
persistent state, provider secrets, Docker socket or controller credentials.
Its [file-descriptor limit](https://www.squid-cache.org/Doc/config/max_filedescriptors/)
is 4096 and its memory-cache target is 16 MiB; the container memory limit remains
the process boundary. Its unused [network journal](https://www.squid-cache.org/Doc/config/netdb_filename/)
is disabled so it does not attempt writes to the read-only image.
The [browser owner](../browser/README.md) specifies its distinct Chromium
seccomp and resource settings.

## Build and test

From the repository root:

```sh
docker build -f deploy/execution/network/Dockerfile.egress -t clawscarf-browser-egress:local .
docker build -f deploy/execution/network/Dockerfile.relay -t clawscarf-runtime-relay:local .
CLAWSCARF_TEST_BROWSER_IMAGE=clawscarf-browser:local \
CLAWSCARF_TEST_BROWSER_EGRESS_IMAGE=clawscarf-browser-egress:local \
CLAWSCARF_TEST_BROWSER_RELAY_IMAGE=clawscarf-runtime-relay:local \
node --import tsx --test tests/runtime/browser-network.test.ts
```

Build the browser first using its owner's recipe. The test needs Docker and
public HTTPS access; it creates and removes unique containers, volumes and an
isolated network. The host listener proves numeric host reachability from an
ordinary container before testing denial from the isolated browser.

The repeatable test covers actual Chromium/CDP, public HTTPS, direct host/metadata
denial, private and mixed-address DNS fixtures, unresolved names, restricted
ports, relay authentication, fixed SSH byte transport, browser denial of the SSH
listener and retained profiles. DNS rebinding across changing
authoritative answers and IPv6-enabled deployment remain unqualified; neither
is claimed by static host fixtures. This packaging is not yet evidence of the
assembled local distribution or a published release.

## Private native node ingress

The [node ingress configuration](node-ingress.cfg) runs in the same pinned HAProxy
image as a separate service for the [native browser node](../browser-node/README.md).
It terminates TLS and forwards only root-path native WebSocket upgrades to the
operator-owned Gateway forward. Browser-Origin requests and ordinary HTTP requests
are refused. It strips trusted-user, forwarding, cookie and Authorization headers;
native bootstrap/device authentication stays inside the unchanged Gateway protocol.
It never adds a user identity or filters native RPC messages. Upgraded connections
have no periodic lifetime cutoff.

The composition must supply these operator-owned settings:

- `CLAWSCARF_NODE_INGRESS_ADDRESS`: the exact address on a dedicated internal
  machine network, reachable only by the browser node. Do not bind all interfaces
  or publish this listener in the assembled deployment.
- `CLAWSCARF_NODE_GATEWAY_PORT`: the fixed retained Gateway forward port on
  `host.docker.internal`. This is not a client-selected upstream.
- `/run/clawscarf/node-ingress.pem`: private read-only server certificate/key PEM,
  readable by the nonroot HAProxy user. Supply the CA or native certificate pin to
  the node; do not disable certificate checking.
- Native `gateway.nodes.pairing.autoApproveLocal: false`, without trusted-CIDR
  auto-approval. Forwarding to loopback must not create pairing authority.

The listener must not bind the Chromium or application-facing network.
The operator gives ingress a separate internal machine interface and an upstream
network attachment; it binds only the machine address and publishes no port.
Team runtime OpenShell policy must deny this machine listener. The native
paired-node credential authorizes the connection; network placement alone does not.

The [ingress regression](../../../tests/runtime/machine-ingress.test.ts) passed TLS,
HTTP/browser-Origin denial, case-insensitive removal of impersonation headers and
native upgrade forwarding using the actual HAProxy image. Set
`CLAWSCARF_TEST_BROWSER_RELAY_IMAGE` and run that test with `node --import tsx --test`.
Its upstream is a controlled handshake fixture; it does not establish native pairing,
revocation or production network isolation. It publishes only a disposable loopback
test listener. Combined local private-node enrollment/navigation passed; ordinary model-selected
routing and release qualification remain open. See the browser-node owner.

## Sources and rights

[Squid 5.7](https://github.com/squid-cache/squid/tree/SQUID_5_7) is supplied by
Debian's security-maintained `5.7-2+deb12u6` package; the image retains Debian's
`/usr/share/doc/squid/copyright` and corresponding dependency notices. Squid is
GPL-2.0-or-later; distributed binaries require corresponding source availability.
The recipe pins its package and CA bundle atop the same digest-pinned Node/Debian
base as the browser. It starts only Squid, with the upstream `proxy` user.

[HAProxy 3.2.23](https://www.haproxy.org/download/3.2/src/haproxy-3.2.23.tar.gz)
is supplied by its digest-pinned official Alpine image. Its
[license](LICENSE.haproxy), [GPL text](COPYING.haproxy) and
[LGPL text](COPYING.LESSER.haproxy) are retained in the derivative image. The
upstream license describes its OpenSSL exception and LGPL headers; distributed
binaries require corresponding source availability. Source remains available in
the exact linked release archive. The small ClawScarf recipes/configuration use
this repository's MIT license. No third-party firewall source is copied or
reimplemented.

Destination checks use Squid's native
[ACLs](https://www.squid-cache.org/Doc/config/acl/) and
[HTTP access rules](https://www.squid-cache.org/Doc/config/http_access/).
The pinned [destination ACL implementation](https://github.com/squid-cache/squid/blob/SQUID_5_7/src/acl/DestinationIp.cc)
checks the resolved addresses; failed lookup must not fall through to allow.
Docker's [isolated gateway mode](https://docs.docker.com/engine/network/port-publishing/)
removes the internal bridge's host address. Port publication alone cannot expose
an isolated browser, which is why the fixed TCP relay is separate.
