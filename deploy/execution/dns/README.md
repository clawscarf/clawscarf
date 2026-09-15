# Browser node DNS

Optional private resolver for the [native browser node](../browser-node/README.md),
selected by the local operator's `browser.dnsImage`. Chromium uses its separate
public-web proxy; this resolver supplies the node's native destination preflight.

[Unbound configuration](unbound.conf) requires an operator-owned deployment file.
The operator binds one private machine address, admits only the browser node's IP
and forwards to fixed resolvers without recursive fallback. Private IPv4/IPv6 answers,
query logging and remote administration are disabled. No DNS port is published.

[Dockerfile](Dockerfile) pins the resolver package and base image.
[Tests](../../../tests/runtime/browser-dns.test.ts), enabled with
`CLAWSCARF_TEST_BROWSER_DNS_IMAGE`, passed public resolution, source refusal,
private-answer filtering and denied direct public TCP. The combined local node
assembly also passed native browser navigation. Linux/release qualification remains open.
