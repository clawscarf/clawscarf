# Preserve encrypted Responses reasoning

## Intent and boundary

Preserve `encrypted_content` byte-for-byte inside a validated Responses reasoning
item in an assistant thinking signature. OpenRouter Responses can append one
base64url routing segment separated by a dot; treating that payload as ordinary
text lets secret redaction corrupt it before the next turn replays it.

Select this behavior by the recognized Responses API, including its native
transport name, regardless of the configured provider label. Keep ordinary
base64-style encrypted values supported. Restrict the additional format to two
nonempty encoded segments with terminal padding; reject whitespace, truncation
markers and extra separators. Do not broaden the shared opaque-token validator
for other APIs, compaction, tool arguments or ordinary text. Preserve signature
metadata validation, summary removal and normal secret redaction.

This patch has no dependency on other patches. It changes neither provider
configuration nor stored schemas and does not repair older conversations.

## Verification and adaptation

Exercise transcript redaction and serialization with synthetic dotted payloads
for direct, OpenRouter, LiteLLM and ClawScarf provider labels, both Responses API
names, malformed payloads and ordinary secret-bearing fields. Retain the native
persistence and reasoning replay regressions. Qualify an installed runtime with
reasoning, tool calls, persisted history, restart and follow-up through Cloud.

On upgrade, remove this patch when upstream preserves the complete valid payload
through the same transcript path. Keep Responses-only validation and the
redaction boundary regressions when adapting the patch.
