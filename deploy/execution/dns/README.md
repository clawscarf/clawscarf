# Browser DNS experiment

Unfinished component for the separate [browser node](../browser-node/README.md).
It is not wired into the operator or a supported deployment. The image was built;
the opt-in live network regression has not passed. See [remaining work](../../../TODO.md).

[Unbound configuration](unbound.conf) requires an explicit mounted deployment file.
The [example](deployment.example.conf) binds a private interface, admits one node IP
and forwards to fixed resolvers without fallback. It filters private answers and
disables query logs and remote administration. These settings alone do not prove
network isolation; an isolated node/ingress/DNS assembly still needs validation.

[Dockerfile](Dockerfile) pins the resolver package and base image.
[Tests](../../../tests/runtime/browser-dns.test.ts) contain recipe checks and an opt-in
network test using `CLAWSCARF_TEST_BROWSER_DNS_IMAGE`. No startup path selects this
image. Decide the browser architecture before extending this experiment.
