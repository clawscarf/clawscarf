# ClawScarf operator

This development archive contains compiled local setup, controller, model and pack
commands. It runs outside the contributor checkout. It is not the complete
distribution: runtime/companion images and the pinned OpenShell executables are
separate inputs. The interactive menu uses recipes from a supplied
release bundle; it does not download/build missing components. The generated npm
package is named `@clawscarf/cli` and exposes the `clawscarf` command, but remains
private/unpublished. [Release contents](README.md) defines the publication model.

## Run the archive

Verify the archive against its accompanying `SHA256SUMS`, then extract it into a new
directory. Use Node 24.16 or later in the Node 24 line, or Node 26.1 or later, and
pnpm 10.33.0. In the extracted `package` directory:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
node scripts/clawscarf.js --help
node scripts/clawscarf.js install --release /absolute/clawscarf-release.json --directory /absolute/new-team
node scripts/clawscarf.js models --help
node scripts/clawscarf.js packs --help
node scripts/clawscarf.js connections --help
node services/connections/credential-command.js --help
```

Dependencies are installed from the included frozen lockfile. Its root importer
contains only the production dependencies referenced by the staged operator;
publisher and browser dependencies are omitted. Locked transitive versions are retained.
No TypeScript compiler, contributor source or build step is needed to run the commands.
The current local assembly supports macOS arm64 with Docker Desktop only.

The installer reviews recipe settings before credentials, prepares the installation,
and offers **Start now**. It starts a macOS user service; closing the terminal leaves it
running. OIDC setup supplies a private first-administrator claim link. The same public
operations are available through `configure`, `validate`, `plan`, `apply`, `start`,
`status`, `stop`, `login` and `administrator`. See the source installation guide for
current retained-settings limitations. The interactive installer still creates new
directories; it does not yet edit every capability on an existing installation.

Without `--release`, the operator expects **clawscarf-release.json** in its **release**
directory. Release publication/discovery remains unfinished. The example recipe supplies
defaults, not a document workflow. Keep the generated release bundle available; its
tools, pack files and optional catalog move together. No original build checkout is needed.

Keep installation data outside this extracted package. Stop retains state; replacing
an operator archive is not a runtime upgrade or backup. User-service startup survives
terminal exit, but is not configured for automatic restart after logout/reboot.
The pack operator additionally needs the pinned Python environment from
`scripts/packs/requirements.txt`. Models require an external LiteLLM gateway or the unified configuration’s pinned local
LiteLLM service. This archive contains no model/provider credentials. Unified preparation
can issue initial scoped model and Connections credentials for fresh installations;
normal start never rotates or reactivates them. The component Connections operator
retains its explicit credential/configuration commands.

The source checkout owns full local setup, model and pack qualification instructions.
[Third-party notices](../THIRD_PARTY_NOTICES.md) are retained verbatim; their relative source references refer
to the source checkout, not additional runtime payload in this archive. Installed
dependencies retain their own notices. Full binary-release license qualification
remains separate from this operator packaging check.
