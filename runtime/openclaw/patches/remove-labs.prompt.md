# Remove Labs

Remove the Labs experiments page from the distribution, including its route,
navigation, search and contextual links. Preserve the underlying native feature
configuration and custom plugin UI: Account, People, Connections and deliberate
administrator additions must still work. Keep the custom plugin UI enablement
control in Plugins, using existing native configuration and controls.

This is UI removal, not a restriction on administrators editing configuration.
Delete obsolete page-owned code and tests. Preserve copy and helpers shared by
retained features. No separate UI, ingress filter or permission model.

No semantic dependency on earlier patches; apply in `series` order. Verify the
retained plugin enablement flow, direct navigation and settings discovery against
the built UI, including mobile. Run affected UI tests, type checks, localization
verification and the build; regenerate the boot manifest through its owner.

On upstream changes, check for new experiment entry points. An upstream switch
can replace the deletion only if it removes the entire selected UI while keeping
custom plugin UI available. Do not submit upstream without explicit authorization.
