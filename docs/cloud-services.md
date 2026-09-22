# Hosted-service contract

This document owns the boundary between ClawScarf installations and
[ClawScarf Cloud](https://github.com/clawscarf/clawscarf-cloud). It does not duplicate
cloud implementation, deployment instructions or the installation workflow.

| Responsibility                                                                    | Owner                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product and team trust model                                                      | [ClawScarf README](../README.md#your-server-your-team)                                                                                                        |
| Hosted/company login selection and installation approval                          | [Installation CLI](../deploy/deployment/installation.md#login-and-administrator)                                                                              |
| Identity, admission, native roles and revocation                                  | [Access](../services/access/README.md)                                                                                                                        |
| Local Connections management authority and callbacks                              | [Management adapter](../services/connections/README.md)                                                                                                       |
| Runtime tools and native Connections page                                         | [Connections plugin](../plugins/connections/README.md)                                                                                                        |
| Cloud accounts, registration, provider integrations, quota policy and maintenance | [Cloud service](https://github.com/clawscarf/clawscarf-cloud) and its [API contract](https://github.com/clawscarf/clawscarf-cloud/blob/main/api/openapi.json) |
| Deployed endpoints, provider settings, callbacks and private credential locations | [Cloud runbook](https://github.com/clawscarf/clawscarf-cloud/blob/main/RUNBOOK.md)                                                                            |
| Imported API snapshot and client generation                                       | [Cloud client](../services/cloud/README.md)                                                                                                                   |

## Independent ownership

Hosted login and Connections are independent choices. Customer OIDC with Connections
disabled requires no cloud registration. A hosting product must be able to supply its
own identity and a compatible broker without an alternative runtime architecture.
Privately operated broker execution must not require our cloud account or identity
provider; packaging that service belongs to the cloud repository.

Cloud account ownership grants neither installation admission nor native administrator
authority. The cloud owner and its account provisioner can replace installation management
and runtime credentials, giving them control of Connections and access to connected
services without local admission. Installations using cloud Connections trust these
principals with that authority. Team invitations grant admission only to the inviting
installation; they grant no cloud-account ownership.

The installation's Access service checks current human authority for its UI and CLI.
The broker trusts assertions supplied with the installation management credential and
enforces credential-derived installation scope and agent grants.
Connector allowances or future payment state must never gate team login.

Registration, management and execution credentials have separate authority. Management
credentials and provider secrets stay outside OpenClaw; only scoped execution credentials
enter the runtime. An installation UUID or an email address is not proof of authority.
Changing identity provider or broker ownership never silently migrates admission,
credentials or linked accounts.

## Integration discipline

Use the versioned API contract and generated clients, not sibling-repository runtime
imports. Cloud services do not read local Access tables or copy native roles. Account
OAuth terminates at the broker; the local adapter owns the returning browser's current
authority check. The cloud service remains responsible for tenant isolation, quotas,
idempotency and explicit uncertain outcomes under its own contract.

Future hosting integrations must reuse those registration and broker services under
an existing customer account, with scoped provisioning authority and an idempotent
external installation reference. They must not require a second signup or a separate
hosting-specific broker implementation. The [runtime hosting boundary](../runtime/README.md#external-hosting-boundary)
defines installation-side requirements; cloud implementation and deployment belong
in the cloud repository. This contract does not implement billing, private-broker
packaging or VM hosting.
