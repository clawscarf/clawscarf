# ClawScarf operator

This development archive contains the compiled configuration/lifecycle CLI and its controller, model and pack
operators. It runs outside the contributor checkout. It is not the complete
distribution: runtime/companion images and the pinned OpenShell executables are
separate inputs. The archive includes recipes, packs, the model catalog and runtime definitions.
The interactive menu lists those recipes; each fixes its runtime. It does not
download missing OpenShell tools or build missing local images. The generated npm
package is named `@clawscarf/cli` and exposes the `clawscarf` command, but remains
private/unpublished. [Release contents](README.md) defines the publication model.

## Run the archive

Verify the archive against its accompanying `SHA256SUMS`, then extract it into a new
directory. Use Node 24.16 or later in the Node 24 line, or Node 26.1 or later, and
pnpm 10.33.0. In the extracted `package` directory:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
node scripts/clawscarf.js --help
node scripts/clawscarf.js configure --directory /absolute/new-team
node scripts/clawscarf.js configure --help
node scripts/clawscarf.js people --help
node scripts/clawscarf.js connections --help
```

Dependencies are installed from the included frozen lockfile. Its root importer
contains only the production dependencies referenced by the staged operator;
publisher and browser dependencies are omitted. Locked transitive versions are retained.
No TypeScript compiler, contributor source or build step is needed to run the commands.
The current local assembly supports macOS arm64 with Docker Desktop only.

The installer reviews recipe settings before credentials, prepares the installation,
and offers **Start now**. It starts Docker services and protected OpenShell containers, then exits; closing
the terminal leaves them running. Administrator setup supplies a private sign-in link and waits for successful
browser setup, with replacement links offered on expiry. The same public
operations use `configure` for new or existing installations, with `--non-interactive`
for automation. `start`, `stop`, `status` and `logs` operate the selected `--directory`.
Validation and preview/apply are internal. See the source installation guide for
supported retained changes and administrator setup.

Recipes select runtime definitions relative to their own files. Published runtime
downloading remains unfinished. The development runtime descriptor uses local image
IDs and expects OpenShell tools prepared separately; the archive alone cannot install
on a clean machine. Custom recipe files can point to a separately prepared runtime
bundle. The example recipe supplies defaults, not a document workflow.

Keep installation data outside this extracted package. Stop retains state; replacing
an operator archive is not a runtime upgrade or backup. Docker services keep running after
terminal exit; Docker must remain available. No host service is installed.
The pack operator additionally needs the pinned Python environment from
`scripts/packs/requirements.txt`. Models require an external LiteLLM gateway or the unified configuration’s pinned local
LiteLLM service. This archive contains no model/provider credentials. Unified preparation
can issue initial scoped model and Connections credentials for fresh installations;
normal start never rotates or reactivates them. Use `configure` for capability changes;
`connections` manages application accounts and grants.

The source checkout owns full local setup, model and pack qualification instructions.
[Third-party notices](../THIRD_PARTY_NOTICES.md) are retained verbatim; their relative source references refer
to the source checkout, not additional runtime payload in this archive. Installed
dependencies retain their own notices. Full binary-release license qualification
remains separate from this operator packaging check.
