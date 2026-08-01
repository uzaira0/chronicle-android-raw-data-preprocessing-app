#!/usr/bin/env bash
# check-web-complexity.sh
# Cyclomatic complexity gate for the web/TypeScript source via ESLint.
#
# Threshold: complexity > 137 (current max in codebase is 137, in
# rustPipelineRuntime.executeRustRuntimeUnlocked).
# The `complexity` rule lives in web/eslint.config.mjs, pinned to the
# current max so existing code passes and any increase fails.
# Lower the ceiling there when the max drops.
#
# Requires: web/eslint.config.mjs and devDependencies eslint, @eslint/js,
#           typescript-eslint.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/web"

echo "=== Web/TypeScript complexity check (threshold: > 137) ==="
npx eslint src \
    --ignore-pattern 'src/wasm/**'
echo "Web complexity check passed (max allowed: 137)."
