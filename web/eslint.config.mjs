// Type-aware lint (ts-type-aware-lint + js-eslint): typescript-eslint with the
// type-checked rule sets + parserOptions.projectService delivers the rules biome/
// oxlint structurally cannot — no-floating-promises, no-misused-promises,
// no-unsafe-*, await-thenable, no-unnecessary-condition — because they have no TS
// type graph. tsconfig.json includes ["src","e2e"]; projectService auto-discovers
// it, so there are no per-repo project paths to maintain. src/wasm is generated.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/wasm/**', '**/*.config.*'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,mts}', 'e2e/**/*.{ts,tsx,mts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true },
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
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
);
