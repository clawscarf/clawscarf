# ClawScarf

A proposed self-hostable OpenClaw distribution for teams: company login, selected
capabilities with their dependencies, optional model and connection services, and
tested deployment procedures. It must run independently of RawClaw.

**Status:** repository initialized for planning. No runtime, installer or released
artifact exists here yet. OpenShell is the proposed whole-runtime containment
mechanism; its compatibility and security properties for our configuration remain
to be verified. A separately provisioned VM is not a prerequisite for the intended
local installation experience.

[PLAN.md](PLAN.md) owns the initial design, decisions and implementation order.
[AGENTS.md](AGENTS.md) owns contributor conventions. The terminal installer comes
after the runtime, identity, integrations and packs work through reproducible commands.

Use **ClawScarf** in product copy and `clawscarf` for commands and repository names.
The intended parent directory can also contain independent projects such as a website.
