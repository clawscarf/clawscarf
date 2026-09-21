# Contributing to ClawScarf

See the [README](README.md) for the product and quickstart, and the
[installation guide](deploy/deployment/installation.md) for platform requirements. The [task checklist](TODO.md) is the single list of
open work; [AGENTS.md](AGENTS.md) defines engineering and review conventions.

Use the Node and pnpm versions in [package.json](package.json) and follow the
[contributor setup and checks](scripts/README.md). The two plugin builds have their
own locked development dependencies. Real database/native tests require the
environments described in the component READMEs.

Start with one concrete outcome and a small change. For reused work,
copy the relevant implementation and regression tests, record its source revision,
and adapt the standalone boundary. Do not rebuild working mechanisms from a summary.
For upstream behavior, identify the exact version you inspected or exercised.

Describe what the change does, how it was verified, and what remains unverified.
Update the owning documentation in the same change. Preserve third-party notices;
contribute only material you have permission to provide under the applicable license.
Never include credentials, customer data or generated run logs.

## Documentation ownership

Document a fact at its owner and link to it elsewhere. A short introduction may
identify a component's purpose; do not copy its settings, requirements, support
matrix, failure analysis or verification results into another guide.

| Topic                                                                  | Authoritative home                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product purpose, team trust boundary, quickstart                       | [Root README](README.md)                                                                                                                                                         |
| User commands, supported hosts, installer and retained-change behavior | [Installation guide](deploy/deployment/installation.md)                                                                                                                          |
| Developer setup, checks and dependency direction                       | [Tooling guide](scripts/README.md)                                                                                                                                               |
| Build/publish process and release evidence                             | [Release guide](release/README.md); published versions/assets in [GitHub Releases](https://github.com/clawscarf/clawscarf/releases) and their CI runs                            |
| Component behavior, configuration and current limitations              | Its adjacent README; browser integration belongs to [browser-node](deploy/execution/browser-node/README.md), network rules to [network](deploy/execution/network/README.md)      |
| Patch authoring and upstream upgrades                                  | [Distribution guide](runtime/openclaw/README.md); each paired intent owns that patch's requirements                                                                              |
| Open work                                                              | [TODO](TODO.md), short unchecked actions with links to the owning explanation                                                                                                    |
| Cross-repository service boundary                                      | [Hosted-service contract](docs/cloud-services.md); deployed cloud settings belong only to the [cloud runbook](https://github.com/clawscarf/clawscarf-cloud/blob/main/RUNBOOK.md) |
| Attribution and redistribution                                         | [Third-party notices](THIRD_PARTY_NOTICES.md), component provenance and required bundled licenses                                                                                |

Version pins, defaults, API fields and dependency inventories are owned by their
manifests, configuration or schemas. Link to those inputs instead of maintaining
parallel Markdown lists. Task-oriented command examples are examples, not another
defaults table. Keep shipped agent instructions and patch intents self-contained
where their runtime or maintenance purpose requires it.

Component READMEs describe the checkout. A build or source test does not establish
publication or deployment. Put release-specific results in release notes/CI artifacts;
keep only actionable support limits at the component owner, with an exact tested
version when needed. Remove superseded trial narratives and workstation measurements.
Logs and disposable reports belong in ignored `.local/`, never another maintained plan.

When changing behavior, update its owner and TODO together; search for and replace
other explanations with links. When moving a section, update every inbound link.
Run `pnpm docs:check` and formatting checks. These validate references and commands;
review against source, tests and release evidence is still required for accuracy.
