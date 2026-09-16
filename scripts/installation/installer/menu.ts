import { homedir } from "node:os";
import type { InstallationConfiguration } from "../configuration.js";
import type { Recipe } from "../recipes/definition.js";
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
  config: InstallationConfiguration,
  directory: string,
  browserAvailable: boolean,
  packIssues: string[],
  recipe?: Recipe,
): Choice[] {
  const location = directory.startsWith(homedir() + "/")
    ? "~" + directory.slice(homedir().length)
    : directory;
  const agents = config.packs.flatMap((pack) => pack.members);
  return [
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
      config.access.mode === "local" ? "Local login" : "Company login",
      config.access.mode === "local" ? "Loopback only" : "OIDC",
    ),
    row(
      "models",
      "Models",
      config.models.mode === "disabled" ? "Not configured" : config.models.mode,
      recipe?.suggestedModel
        ? `Suggested: ${recipe.suggestedModel.name}, ${recipe.suggestedModel.thinking}`
        : undefined,
    ),
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
    { value: "review", label: "Review and continue" },
  ];
}
