# Connections HTTP composition

[registerConnectionsHttp](http.ts) attaches the optional service and its browser
assets to the existing access companion. It uses the shared Access session and CSRF
port, OpenAPI route registration and generated Fastify handler types. Domain services
own native authority and operation outcomes. The access companion owns common request
validation, response validation and safe HTTP failures.

The [contract](../openapi.json) owns all paths beneath `/_clawscarf/connections`.
The OpenClaw plugin uses that prefix as its broker base URL and keeps the public
broker's `/v1/connector-runtime/*` paths. Machine bearer credentials are never
accepted as human management sessions. Requests with both machine credentials and
browser cookies are rejected. Credential rotation/revocation is an explicit
administrator API; the rotation response is private, uncacheable and shown once.

Provider redirects enter `/verify`. Their opaque reference is encrypted and bound
to an HttpOnly cookie, then the browser sees a clean `/return/:id` path. Completing
that return requires the authenticated setup initiator and CSRF protection. No
query logging or provider token is exposed to browser JavaScript.

When unconfigured, only authenticated availability and the disabled account page
are registered; no provider or broker operation is available. UI assets are built
with the [web package commands](../web/README.md).

## Reuse

Resource handlers and callback mechanics are extracted from
[RawClaw runtime at f37a6e7](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/domains/connections/runtime),
with organization/installation routing replaced by a configured server scope.
The Access companion replaces the donor authentication and framework composition;
public REST shapes remain owned by the local generated contract.
