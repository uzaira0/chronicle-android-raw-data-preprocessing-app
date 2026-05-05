import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Complexity ceiling: current max in codebase is 36; threshold set to 37
      // to prevent regressions without blocking existing code.
      complexity: ["error", { max: 37 }],
      // Suppress JS-only rules that don't apply to TS files linted without full type info
      "no-undef": "off",
      "no-unused-vars": "off",
      // ESLint v10 false-positive: flags valid initialization-then-conditional-reassignment patterns
      "no-useless-assignment": "off",
      // Enable so the eslint-disable-next-line comment in notification.ts is valid
      "no-new": "warn",
      // Carry forward the react-hooks rule referenced in inline disable comments
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    ignores: ["dist/**", "src/wasm/**", "coverage/**"],
  },
];
