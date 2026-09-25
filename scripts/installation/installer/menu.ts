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
      ...(existing ? { hint: "Review before changing the server" } : {}),
    },
    row(
      "access",
      "Team login",
      config.access.mode === "hosted"
        ? "ClawScarf Cloud · Free"
        : "Custom OIDC",
      "Free team sign-in; company OIDC is also available",
    ),
    row(
      "models",
      "AI",
      modelSummary ?? "Choose a model",
      config.models?.mode === "litellm" && config.models.cloud
        ? "ClawScarf Cloud · Prepaid credits · No provider key needed"
        : "Your provider account and billing",
    ),
    row(
      "connections",
      "Connections",
      config.connections.mode === "disabled"
        ? "Off"
        : "ClawScarf Cloud · Paid beyond allowance",
      config.connections.mode === "disabled"
        ? undefined
        : "Connect business apps; extra usage uses prepaid packs",
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
    ...(browserAvailable
      ? [
          row(
            "browser",
            "Browser",
            config.browser.enabled ? "On · Administrators only" : "Off",
          ),
        ]
      : []),
    row(
      "public-web",
      "Public web",
      config.publicWeb ? "On" : "Off",
      "HTTP(S) for agents and tools; private destinations blocked",
    ),
    row(
      "location",
      "Location",
      location.length > 40 ? "…" + location.slice(-39) : location,
      directory,
    ),
    row(
      "exposure",
      "Network",
      config.exposure.mode === "local"
        ? "This computer"
        : config.exposure.applicationOrigin,
    ),
    row(
      "resources",
      "Resources",
      `${config.resources.runtime.cpu} CPU / ${config.resources.runtime.memory}`,
      "Protected team runtime",
    ),
  ];
  return existing
    ? [
        ...choices.filter(({ value }) =>
          [
            "review",
            "models",
            "connections",
            "packs",
            "browser",
            "public-web",
          ].includes(value),
        ),
        ...(config.models?.mode === "litellm" && config.models.cloud
          ? []
          : [{ value: "model-credentials", label: "Change LLM API keys" }]),
      ]
    : choices.map((choice) =>
        ["connections", "public-web"].includes(choice.value)
          ? { ...choice, label: choice.label + "\n" }
          : choice,
      );
}
