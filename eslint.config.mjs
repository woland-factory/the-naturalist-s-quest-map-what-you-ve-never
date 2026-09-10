import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      // TypeScript's own compiler enforces unused/undefined; keep ESLint to
      // real logic smells and let tsc own the type surface.
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
