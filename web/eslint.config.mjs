// Type-aware lint (ts-type-aware-lint + js-eslint): typescript-eslint with the
// type-checked rule sets + parserOptions.project delivers the rules biome/
// oxlint structurally cannot — no-floating-promises, no-misused-promises,
// no-unsafe-*, await-thenable, no-unnecessary-condition — because they have no TS
// type graph. Use the compiler project: the language service silently skips our
// generated registry JSON above its 4 MiB per-file limit. tsconfig.json includes
// ["src","e2e"]; src/wasm is generated.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/wasm/**', '**/*.config.*'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,mts}', 'e2e/**/*.{ts,tsx,mts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Cyclomatic complexity ceiling, enforced by scripts/check-web-complexity.sh
      // (pre-commit web-complexity hook). Pinned to the current codebase max
      // (rustPipelineRuntime.executeRustRuntimeUnlocked = 137) so existing code
      // passes and any increase fails. Lower it when the max drops.
      complexity: ['error', 137],
    },
  },
  {
    // Production code states its invariants instead of asserting them away:
    // narrow the type, or call requireDefined() from src/lib/invariant.ts so a
    // broken invariant throws an Error naming it.
    // Tests, test support and e2e may still use `!` on fixtures they built.
    files: ['src/**/*.{ts,tsx,mts}'],
    ignores: ['src/**/*.test.{ts,tsx,mts}', 'src/testSupport/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
);
