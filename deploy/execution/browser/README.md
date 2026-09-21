# Shared team browser

This optional image runs one team-owned Chromium profile outside the Gateway.
It contains Chromium and a small authenticated CDP proxy/lifecycle process;
there is no OpenClaw installation, controller credential or container socket.
The profile belongs to the team: authorized browser users share its cookies,
logins and files. This is not per-person browser isolation.

## Build and configuration

```sh
docker build -f deploy/execution/browser/Dockerfile -t clawscarf-browser:local .
```

[Dockerfile](Dockerfile) pins Node and the Debian Chromium/sandbox packages.
The process runs as UID/GID 1000. Mount persistent state
at `/state`, owned by that user, and a read-only private credential file. Set
`CLAWSCARF_BROWSER_TOKEN_FILE` to that file; it must have no group/other permissions
and contain at least 32 non-whitespace characters. Generate a random credential,
never a human password. It is not placed in image layers or process arguments.

The container requires:

- `user: "1000:1000"`, `cap_drop: [ALL]`, `read_only: true`.
- `security_opt: [no-new-privileges:true, seccomp:<absolute path to seccomp.json>]`.
- Private `/tmp` tmpfs (512 MiB), private shared memory (256 MiB), an init process,
  and bounded memory/PIDs (the local test uses 1 GiB and 256 PIDs).
- A stop grace period of at least 12 seconds.
- A private network route from the browser controller to TCP 9223. Do not publish CDP publicly.

Chromium listens only on loopback 9222. The proxy on 9223 authenticates **each HTTP
request and WebSocket upgrade**, accepting Basic `openclaw:<token>` or Bearer
credentials. Requests with an `Origin` header are rejected: this endpoint is for
server-side CDP clients, not browser-origin JavaScript. Tokens never enter the
upstream Chromium request. `httpxy` owns HTTP framing, keepalive and WebSockets;
there is no custom TCP/HTTP parser. Active streams have no periodic cutoff.
Transport across untrusted networks requires TLS or a private authenticated tunnel.

The [discovery adapter](discovery.ts) uses httpxy's response hook for `/json/version`,
`/json`, `/json/list` and `PUT /json/new`. It retains Chromium's current target path
and advertises the authenticated request's original Host and port, so discovery
works through the fixed TCP relay or a published loopback port. Forwarded headers
and credentials never determine or appear in the advertised URL. Chromium still
receives only the fixed loopback Host. Responses are uncached, limited to 1 MiB and
validated before rewriting; malformed discovery returns 502. Discovery does not
create additional requests or cache browser identifiers across restarts. The helper
is type-checked with the repository and stripped by pinned Node during image build.
This image serves private HTTP/WebSocket CDP; HTTPS termination with different
advertised schemes needs an explicit deployment configuration and qualification.

The [native browser-node owner](../browser-node/README.md#image-and-immutable-configuration)
defines the OpenClaw profile, credentials and authorization. This image only serves
Chromium/CDP; it does not own Gateway configuration or native role policy.

`CLAWSCARF_BROWSER_PROXY_SERVER` optionally supplies an HTTP egress-proxy origin
without credentials. The launcher configures Chromium to proxy loopback targets as
well. **Browser proxy flags are not a network security boundary.** The surrounding
network must block direct access to Gateway/controller/companion private endpoints,
metadata addresses and unrelated host services. The [isolated network composition](../network/README.md) has its own real Chromium
regression; the simpler component test uses Docker's ordinary bridge and does not qualify egress.

## Lifecycle and verification

The launcher waits for Chromium before exposing the proxy. Missing/invalid private
credentials, failed browser startup or a failed proxy stop the container. SIGTERM
first closes incoming CDP connections, requests native `Browser.close` to flush
profile state, and waits before bounded TERM/KILL fallback. A forced kill or machine
failure has Chromium's own crash-recovery guarantees; it is not a backup.

Run the opt-in component regression after building:

```sh
CLAWSCARF_TEST_BROWSER_IMAGE=clawscarf-browser:local \
  pnpm exec tsx --test tests/runtime/browser.test.ts
```

It creates only labeled disposable containers/volumes, publishes a random loopback
port, uses a synthetic cookie, and does not connect an external user account.
The test exercises native namespace/seccomp sandbox status, HTTP/WebSocket
authentication (including pipelining and browser-Origin rejection), advertised
browser/page URLs and profile persistence across graceful restart. The
[discovery tests](../../../tests/runtime/browser-discovery.test.ts) cover invalid
authorities, upstream endpoints, response bounds and UTF-8 framing.
[Network acceptance](../network/README.md#build-and-test) owns egress checks;
[native integration limits](../browser-node/README.md#verified-release-limits) own
model-driven browsing and file transfer. Component tests do not establish those journeys.

## Provenance

The namespace policy derives from Playwright 1.63.0's
[seccomp profile](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json)
(source SHA-256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`).
It preserves Docker's default-deny syscall list and upstream allowances for
`clone`, `setns` and `unshare`, adding `chroot` because Chromium uses it inside its
new user namespace while the outer container has all capabilities dropped.
This does not add `CAP_SYS_ADMIN` or `CAP_SYS_CHROOT` to the container. The host
kernel must permit unprivileged user namespaces; host LSM policies that deny them
need their own reviewed profile, not a blanket privileged or unsandboxed fallback.
[LICENSE.playwright](LICENSE.playwright) retains Apache-2.0 terms.

The HTTP proxy follows the already extracted Access provider's `httpxy` pattern;
[package-lock.json](package-lock.json) pins 0.5.5 and
[LICENSE.httpxy](LICENSE.httpxy) preserves its MIT notice. The native OpenClaw CDP
TCP relay was examined but is not incorporated: its connection-level authorization
is insufficient for independently authenticated keepalive requests. Chromium's
Debian copyright material remains under `/usr/share/doc` in the image. These
component notices do not replace the release-wide transitive license review.
