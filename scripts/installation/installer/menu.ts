import { homedir } from "node:os";
import type { InstallationDraft } from "../configuration.js";
import type { Choice } from "./prompts.js";

function row(
  value: string,
  label: string,
  summary: string,
  hint?: string,
): Choice {
  return {
    value,
    label: `${label.padEnd(24)}${summary}`,
    ...(hint ? { hint } : {}),
  };
}
export function installationMenu(
  config: InstallationDraft,
  directory: string,
  browserAvailable: boolean,
  packIssues: string[],
  modelSummary?: string,
  existing = false,
): Choice[] {
  const location = directory.startsWith(homedir() + "/")
    ? "~" + directory.slice(homedir().length)
    : directory;
  const agents = config.packs.flatMap((pack) => pack.members);
  const choices: Choice[] = [
    {
      value: "review",
      label: existing ? "Review and apply\n" : "Accept settings and continue\n",
      hint: existing
        ? "Review before changing the server"
        : "Credentials come next",
    },
    row(
      "location",
      "Location",
      location.length > 40 ? "…" + location.slice(-39) : location,
      directory,
    ),
    row(
      "identity",
      "Name and administrator",
      `${config.name} · ${config.access.administratorName}`,
    ),
    row(
      "access",
      "Access",
      config.access.mode === "hosted" ? "ClawScarf login" : "Custom OIDC",
      "Configure your own OIDC provider (optional)",
    ),
    row(
      "exposure",
      "Network",
      config.exposure.mode === "local"
        ? "This computer"
        : config.exposure.applicationOrigin,
    ),
    row("models", "Models", modelSummary ?? "Choose a model"),
    row(
      "connections",
      "Connections",
      config.connections.mode === "disabled" ? "Off" : config.connections.mode,
    ),
    row(
      "packs",
      "Packs",
      packIssues.length
        ? "Needs attention"
        : agents.length
          ? `${String(agents.length)} agents selected`
          : "None",
      packIssues.length ? packIssues.join(" ") : agents.join(", "),
    ),
    row(
      "resources",
      "Resources",
      `${config.resources.gateway.cpu} CPU / ${config.resources.gateway.memory} · ${config.resources.worker.cpu} CPU / ${config.resources.worker.memory}`,
      "Gateway · protected worker",
    ),
    ...(browserAvailable
      ? [
          row(
            "browser",
            "Browser",
            config.browser.enabled ? "On (experimental)" : "Off",
          ),
        ]
      : []),
    { value: "advanced-models", label: "Advanced model gateway settings" },
  ];
  return existing
    ? [
        ...choices.filter(({ value }) =>
          ["review", "models", "connections", "packs"].includes(value),
        ),
        { value: "model-credentials", label: "Change LLM API keys" },
        ...(config.connections.mode === "disabled"
          ? []
          : [
              {
                value: "connection-credentials",
                label: "Change Connections backend key",
              },
            ]),
      ]
    : choices;
}
