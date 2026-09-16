# ClawScarf operator

This development archive contains compiled local setup, controller, model and pack
commands. It runs outside the contributor checkout. It is not the complete
distribution: runtime/companion images and the pinned OpenShell executables are
separate inputs. There is no automatic installer or published release yet.

## Run the archive

Verify the archive against its accompanying `SHA256SUMS`, then extract it into a new
directory. Use Node 24.16 or later in the Node 24 line, or Node 26.1 or later, and
pnpm 10.33.0. In the extracted `package` directory:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
node scripts/clawscarf.js --help
node scripts/local.js --help
node scripts/models.js --help
node scripts/packs.js --help
node scripts/local.js connections --help
node services/connections/credential-command.js --help
```

Dependencies are installed from the included frozen lockfile. Their development
declarations are retained solely to match that lockfile; `--prod` excludes them.
No TypeScript compiler, contributor source or build step is needed to run the commands.
The current local assembly supports macOS arm64 with Docker Desktop only.

With the separately prepared local input file and exact images/executables:

```sh
node scripts/local.js prepare --directory /absolute/private/installation --config /absolute/local-input.json
node scripts/local.js start --directory /absolute/private/installation
```

Keep installation data outside this extracted package. Stopping the foreground
process retains state; replacing an operator archive is not a runtime upgrade or
backup. The pack operator additionally needs the pinned Python environment from
`scripts/packs/requirements.txt`. Optional models use an external gateway or the unified configuration’s pinned local
LiteLLM service. This archive contains no model/provider credentials. Unified preparation
can issue initial scoped model and Connections credentials for fresh installations;
normal start never rotates or reactivates them. The component Connections operator
retains its explicit credential/configuration commands.

The source checkout owns full local setup, model and pack qualification instructions.
[Third-party notices](../THIRD_PARTY_NOTICES.md) are retained verbatim; their relative source references refer
to the source checkout, not additional runtime payload in this archive. Installed
dependencies retain their own notices. Full binary-release license qualification
remains separate from this operator packaging check.
