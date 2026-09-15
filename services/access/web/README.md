# People

The account page at `/_clawscarf/account/` shows the signed-in identity and Sign out
without requesting administrator authority. The People page at `/_clawscarf/team/` manages admission to one server. It uses
[the Access generated client](../generated/client/sdk.gen.ts) and TanStack Query;
OpenClaw continues to own application roles and agents. Team mode permits a current
native administrator to enroll a provider subject as a member and revoke access.
The shared page header offers OpenClaw and Sign out. Sign out revokes the current
companion session and follows the configured provider logout redirect. On narrow
screens, each person’s email appears beneath their name so removal stays visible.
When configured, Connections appears in People after the existing administrator
check succeeds. Link metadata comes from composition; session refresh adds no
native request and the account page remains available without a native check.
Local mode does not offer company enrollment. The People read observes native enrollment
configuration after verifying current administrator authority. Company mode offers
Enable team access before Add person when initial preparation is needed. Conflicting
native role configuration directs the administrator to OpenClaw. A failed read never
implies missing setup; denied authority hides administrator navigation/actions and
disables an already-open mutation dialog. Failed mutations refresh observation without
replaying writes. If native setup changes while adding someone, preparation stays
inside that dialog and preserves the entered fields.

Desktop (1280px) and mobile (390px) browser checks cover setup, retained form input,
conflicting native setup and authorization denial, using controlled REST responses.
Native observation unit tests cover readiness/conflicts and administrator denial;
real PostgreSQL/REST tests cover the response and session boundary. These checks do
not replace company-login acceptance against a running native installation.

Build with `pnpm access:web:build`. The service hosts the resulting assets; development
Vite is available through `pnpm access:web:dev` on port 5173, proxying access APIs
to port 18800. For this development arrangement, configure Access’s public `origin`
as `http://127.0.0.1:5173` while keeping its listener on port 18800. Local sign-in, native profile presentation and the People desktop view have been
checked in the browser. The 390px mobile People layout and browser sign-out returning native bookmarks to
login have also passed. The native navigation plugin opens the account page.
Interactive company enrollment remains unverified.

Visual primitives and theme are copied from
[RawClaw's Kora-derived UI at f37a6e7](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c/src/apps/web/shared),
matching the separately extracted Connections page. They are locally owned, not
imports into another companion's private presentation layer.
