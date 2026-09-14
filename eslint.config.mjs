import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/generated/**",
      ".local/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "apps/**/*.ts",
      "runtime/**/*.ts",
      "plugins/access/src/**/*.ts",
      "services/**/*.ts",
      "services/**/*.tsx",
      "tests/**/*.ts",
      "plugins/connections/src/**/*.ts",
      "plugins/connections/tests/**/*.ts",
    ],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
    },
  },
  {
    files: ["services/*/{types,shared,service}/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          globals: ["fetch", "WebSocket", "EventSource"],
          checkGlobalObject: true,
        },
      ],
    },
  },
  {
    files: ["services/**/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
  {
    files: ["plugins/connections/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: [".dependency-cruiser.cjs"],
    languageOptions: { globals: { module: "readonly" } },
  },
);
