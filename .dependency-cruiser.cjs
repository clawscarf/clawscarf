module.exports = {
  forbidden: [
    {
      name: "companion-app-uses-named-composition-boundaries",
      severity: "error",
      from: { path: "^apps/companion/" },
      to: {
        path: "^services/",
        pathNot:
          "^services/(access/(runtime/(composition|config)|types/(native|native-errors))|connections/(composition|cloud/http|runtime/http|providers/catalog/provider|shared/errors|types/(provider|errors)))\\.ts$",
      },
    },
    {
      name: "components-do-not-import-process-apps",
      severity: "error",
      from: { path: "^(services|runtime|plugins)/" },
      to: { path: "^apps/", pathNot: "^apps/process-lifecycle\\.ts$" },
    },
    {
      name: "shared-ui-is-domain-independent",
      severity: "error",
      from: { path: "^ui/" },
      to: { path: "^(apps|services|scripts|runtime|plugins)/" },
    },
    {
      name: "only-web-imports-shared-ui",
      severity: "error",
      from: {
        path: "^(apps|services|scripts|runtime|plugins)/",
        pathNot: "^services/[^/]+/web/|^plugins/(access|connections)/src/",
      },
      to: { path: "^ui/" },
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
          "^services/(cloud/generated/|access/(runtime/config\\.ts|repo/postgres\\.ts|generated/)|connections/(cloud/generated/|generated/|providers/catalog/provider\\.ts|repo/(catalog-publication|bootstrap)\\.ts|service/catalog-publication\\.ts|shared/errors\\.ts|types/catalog\\.ts))",
      },
    },
    ...["access", "connections"].flatMap((domain) => {
      const base = `^services/${domain}/`;
      return [
        {
          name: `${domain}-types-are-framework-free`,
          severity: "error",
          from: { path: base + "(types|shared)/" },
          to: {
            path: base + "(service|repo|providers|runtime|web|generated)/",
          },
        },
        {
          name: `${domain}-services-use-ports`,
          severity: "error",
          from: { path: base + "service/" },
          to: { path: base + "(repo|providers|runtime|web|generated)/" },
        },
        {
          name: `${domain}-repositories-own-sql-only`,
          severity: "error",
          from: { path: base + "repo/" },
          to: { path: base + "(service|providers|runtime|web|generated)/" },
        },
        {
          name: `${domain}-providers-use-domain-ports`,
          severity: "error",
          from: { path: base + "providers/" },
          to: { path: base + "(repo|service|runtime|web|generated)/" },
        },
        {
          name: `${domain}-browser-uses-generated-rest`,
          severity: "error",
          from: { path: base + "web/" },
          to: { path: base + "(types|shared|service|repo|providers|runtime)/" },
        },
        {
          name: `${domain}-domain-has-no-direct-io`,
          severity: "error",
          from: { path: base + "(types|shared|service)/" },
          to: {
            path: "^(node:)?(fs|child_process|http|https|net|tls|dgram|dns)(/|$)|node_modules/(pg|openid-client|fastify|@openclaw/gateway-client)/",
          },
        },
      ];
    }),
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
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
      conditionNames: ["import", "node", "default"],
      exportsFields: ["exports"],
      mainFields: ["module", "main", "types"],
    },
  },
};
