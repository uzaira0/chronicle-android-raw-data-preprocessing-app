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
