module.exports = {
  forbidden: [
    {
      name: "companion-app-uses-named-composition-boundaries",
      severity: "error",
      from: { path: "^apps/companion/" },
      to: {
        path: "^services/",
        pathNot:
          "^services/(access/(runtime/(composition|config)|types/native)|connections/cloud/http)\\.ts$",
      },
    },
    {
      name: "components-do-not-import-process-apps",
      severity: "error",
      from: { path: "^(services|runtime|plugins)/" },
      to: { path: "^apps/", pathNot: "^apps/process-lifecycle\\.ts$" },
    },
    {
      name: "plugin-common-is-domain-independent",
      severity: "error",
      from: { path: "^plugins/common/" },
      to: {
        path: "^(apps|services|scripts|runtime|plugins)/",
        pathNot: "^plugins/common/",
      },
    },
    {
      name: "only-plugins-import-common",
      severity: "error",
      from: {
        path: "^(apps|services|scripts|runtime|plugins)/",
        pathNot: "^plugins/(common/|(access|connections)/src/)",
      },
      to: { path: "^plugins/common/" },
    },
    {
      name: "operator-internals-do-not-import-cli-entries",
      severity: "error",
      from: {
        path: "^scripts/(installation|deployment|models|packs|release)/",
      },
      to: {
        path: "^scripts/(clawscarf|deployment|models|packs|controller)\\.ts$",
      },
    },
    {
      name: "component-operators-do-not-import-installation-ui",
      severity: "error",
      from: { path: "^scripts/(deployment|models|packs)/" },
      to: { path: "^scripts/installation/" },
    },
    {
      name: "operator-services-use-named-boundaries",
      severity: "error",
      from: { path: "^scripts/", pathNot: "\\.test\\.ts$" },
      to: {
        path: "^services/",
        pathNot:
          "^services/(cloud/generated/|access/(runtime/config\\.ts|repo/postgres\\.ts|generated/)|connections/cloud/generated/)",
      },
    },

    {
      name: "access-types-are-framework-free",
      severity: "error",
      from: { path: "^services/access/(types|shared)/" },
      to: {
        path: "^services/access/(service|repo|providers|runtime|web|generated)/",
      },
    },
    {
      name: "access-services-use-ports",
      severity: "error",
      from: { path: "^services/access/service/" },
      to: { path: "^services/access/(repo|providers|runtime|web|generated)/" },
    },
    {
      name: "access-repositories-own-sql-only",
      severity: "error",
      from: { path: "^services/access/repo/" },
      to: {
        path: "^services/access/(service|providers|runtime|web|generated)/",
      },
    },
    {
      name: "access-providers-use-domain-ports",
      severity: "error",
      from: { path: "^services/access/providers/" },
      to: { path: "^services/access/(repo|service|runtime|web|generated)/" },
    },
    {
      name: "access-browser-uses-generated-rest",
      severity: "error",
      from: { path: "^services/access/web/" },
      to: {
        path: "^services/access/(types|shared|service|repo|providers|runtime)/",
      },
    },
    {
      name: "access-domain-has-no-direct-io",
      severity: "error",
      from: { path: "^services/access/(types|shared|service)/" },
      to: {
        path: "^(node:)?(fs|child_process|http|https|net|tls|dgram|dns)(/|$)|node_modules/(pg|openid-client|fastify|@openclaw/gateway-client)/",
      },
    },
    {
      name: "connections-use-access-public-boundary",
      severity: "error",
      from: { path: "^services/connections/" },
      to: {
        path: "^services/access/",
        pathNot: "^services/access/(types/(native|errors)\\.ts$|generated/)",
      },
    },
    {
      name: "access-does-not-import-connections-internals",
      severity: "error",
      from: { path: "^services/access/" },
      to: { path: "^services/connections/" },
    },
    {
      name: "portable-runtime-is-independent",
      severity: "error",
      from: { path: "^runtime/" },
      to: { path: "^(services|plugins|scripts)/" },
    },
    {
      name: "no-circular-imports",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable-imports",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "plugins-use-protocols-not-companion-internals",
      severity: "error",
      from: { path: "^plugins/" },
      to: {
        path: "^(services|scripts)/",
        pathNot:
          "^services/(access/generated/|cloud/generated/|connections/cloud/generated/)",
      },
    },
    {
      name: "companions-do-not-import-plugin-or-tooling-internals",
      severity: "error",
      from: { path: "^services/" },
      to: { path: "^(plugins|scripts)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules|(^|/)generated/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".js", ".mjs", ".json"],
      conditionNames: ["import", "node", "default"],
      exportsFields: ["exports"],
      mainFields: ["module", "main", "types"],
    },
  },
};
