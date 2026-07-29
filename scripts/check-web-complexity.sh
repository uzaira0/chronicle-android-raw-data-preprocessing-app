#!/usr/bin/env bash
# check-web-complexity.sh
# Cyclomatic complexity gate for the web/TypeScript source via ESLint.
#
# Threshold: complexity > 37 (current max in codebase is 36, in
# plotGenerator.generateParticipantPlotBlob).
# Set to current-max + 1 so existing code is not blocked but regressions
# that push beyond the ceiling are caught.
#
# Requires: web/eslint.config.mjs and devDependencies eslint, @eslint/js,
#           @typescript-eslint/parser, eslint-plugin-react-hooks.
#
# To add to .pre-commit-config.yaml see scripts/pre-commit-additions-licenses-complexity.txt
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/web"

echo "=== Web/TypeScript complexity check (threshold: > 37) ==="
npx eslint src \
    --ext .ts,.tsx \
    --ignore-pattern 'src/wasm/**'
echo "Web complexity check passed (max allowed: 37)."
