# Disable server self-updates

ClawScarf updates bundled OpenClaw through runtime image releases. Add
`OPENCLAW_NO_SELF_UPDATE=1` so the image can disable core self-updates without
changing Gateway restart or supervisor behavior. Its launcher sets the flag;
the fresh-install preset uses the existing background-check and auto-update flags.
Do not add a new config key to the source CLI that older pinned images cannot read.

When disabled, reject manual Gateway and CLI core updates before effects, and
skip Doctor update offers and background checks/application. Preserve ordinary
configuration restarts and explicit administrator-installed plugin/skill updates.
Use one native policy helper for the environment flag. This is application
policy; trusted runtime code and administrators retain their existing authority.

Remove the server Updates page, navigation, settings search, contextual actions
and update prompts from this distribution. Delete exclusively owned UI code and
obsolete tests. Preserve stale browser-asset detection/reload, normal connection
recovery, configuration restart controls and shared native-device contracts.

No semantic dependency on Labs; use `series` order. Verify rejection before update
effects through the real entry points, automatic-check suppression and retained
extension updates. Run affected regressions, type checks, UI build/localization,
full build and exact patch replay. Image/release qualification is separate.

On upgrade, audit new core update entry points and discovery. If upstream provides
equivalent policy, retire our policy additions; do not substitute a supervisor
mode that changes process lifecycle merely to disable updates. No upstream
submission or release is implied by maintaining this patch.
