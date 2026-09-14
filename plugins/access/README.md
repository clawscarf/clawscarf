# ClawScarf account navigation

A small native UI plugin for the standalone Access companion. It adds **Your
account** to OpenClaw’s navigation, opening the same-origin companion account page
where every admitted user can sign out. Native administrators also see **People**.
The companion independently verifies current authority for management operations;
nav visibility is only a presentation hint.

This plugin uses the public experimental `openclaw/plugin-sdk/control-ui` page and
navigation registrations in pinned OpenClaw 2026.9.4. It does not inject UI, intercept
native logout, add tools or implement authentication. Build and validate with
`npm --prefix plugins/access run build` and `npm --prefix plugins/access run validate`.
The native builder records content-addressed browser assets in the manifest.
Enable the plugin and `gateway.controlUi.experimental.customPlugins` in an explicit
reviewed preset; administrators can disable either. The native sidebar and account
page navigation have been checked in the browser against that pinned release.

The Access companion must serve `/_clawscarf/account/` and `/_clawscarf/team/` on the
same origin as OpenClaw. Other distributions or RawClaw may omit this plugin and
provide their own navigation. There are no RawClaw dependencies.

See [Access](../../services/access/README.md) for session, enrollment and logout
semantics and upstream’s [native UI plugin documentation](https://docs.openclaw.ai/plugins/feature-plugins)
for the experimental host contract.
