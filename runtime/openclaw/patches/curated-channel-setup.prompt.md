# Channel setup from installed plugins

## Intent and dependencies

Keep native channel setup consistent with the plugins available in the installation.
Apply after `optional-marketplace` and `curated-image-inventory`, in series order.
The [inventory](../inventory.json) owns packaged plugins; native plugin discovery
owns available channels; marketplace policy owns remote acquisition. Do not add a
second channel allowlist, registry, or configuration setting.

WhatsApp, Discord, Google Chat, Slack and Nostr are restored alongside Telegram.
Signal and iMessage remain outside the default image because they require an
additional Signal service or a signed-in Messages Mac, respectively. Their default
UI entries disappear with their missing plugins; this is not a ban on deliberate
administrator installations. Nostr uses outbound relay WebSockets and a private key.
Google Chat requires a reachable authenticated webhook through ingress. Packaged
code is not proof of a working external account or deployment route.

## Required behavior

- When marketplace integration is disabled, native setup discovery lists only
  trusted locally available channel contributions, including unconfigured bundled
  plugins and administrator-installed plugins. Use channel IDs declared by plugin
  metadata; plugin and channel IDs need not match. Preserve native visibility,
  activation, authorization and account controls.
- Gateway channel metadata and the Channels page expose the same locally available
  setup choices without loading plugin execution code solely for presentation.
  Preserve configured-channel status, account errors and existing status filters.
- Remove the hardcoded recommended-channel fallback and `More channels…` catalog
  entry. Show additional installed channels directly on the page. Distinguish
  loading, unavailable and empty inventory, retaining known data during refresh.
- A direct request for an unavailable channel fails visibly before installation or
  config writes. Other refused acquisition attempts expose their reason instead
  of silently returning to selection. Cover native wizard/CLI shared owners, not
  an ingress RPC filter or a UI-only guard.
- Preserve marketplace-enabled setup behavior and explicit-source plugin installs.
  Preserve shared native channel implementations needed by administrator additions.

## Verification and maintenance

Exercise absent and locally installed channel metadata, differing plugin/channel
IDs, bundled enablement with marketplace disabled, administrator additions,
marketplace-enabled discovery and unavailable targeted setup. Verify the actual
wizard refusal and Channels page, including pending/error and desktop/mobile views.
Run image inventory checks after building the selected plugins; source tests and
mocked UI proof do not establish live account linking, messaging, webhook reachability
or release deployment. Keep those evidence boundaries explicit.

On upstream upgrades review discovery, status metadata, setup entry points and the
Channels UI together. Retire this patch if upstream provides equivalent availability
semantics; retain the inventory choices and regressions. Do not restore remote
catalog access merely to make a removed plugin's setup succeed.
